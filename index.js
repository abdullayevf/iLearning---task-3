import crypto from "node:crypto";
import readline from "readline";
import AsciiTable from "ascii-table";

// --- Utility: prompt user input with support for ? and X ---
function getUserInput(prompt, maxOption) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(prompt, (answer) => {
            rl.close();
            const trimmed = answer.trim();
            if (trimmed.toUpperCase() === "X") {
                console.log("Exiting. Farewell, mortal.");
                process.exit(0);
            }
            if (trimmed === "?") {
                resolve("?");
            } else if (maxOption !== undefined) {
                const idx = parseInt(trimmed, 10);
                if (isNaN(idx) || idx < 0 || idx >= maxOption) {
                    console.log("Invalid selection.");
                    process.exit(1);
                }
                resolve(idx);
            } else {
                resolve(trimmed);
            }
        });
    });
}

// --- Step 1 & 2: parse and validate dice configs ---
function parseDice() {
    return process.argv.slice(2);
}

function validateDice(dice) {
    if (dice.length < 3) {
        console.log("Error: at least 3 dice configurations required.");
        console.log("Example: node node.js 2,2,4,4,9,9 6,8,1,1,8,6 7,5,3,7,5,3");
        process.exit(1);
    }
    dice.forEach((cfg) => {
        const parts = cfg.split(",");
        if (parts.length !== 6 || parts.some(p => !/^[-]?\d+$/.test(p))) {
            console.log(`Error: invalid dice config '${cfg}'. Must be 6 comma-separated integers.`);
            process.exit(1);
        }
    });
}

// --- Dice abstraction ---
class Die {
    constructor(faces) {
        this.faces = faces;
    }
    getFace(index) {
        return this.faces[index];
    }
}

// --- Provably fair RNG with HMAC-SHA3 commit-reveal ---
class FairRandomGenerator {
    constructor(max) {
        this.max = max;
    }

    generateKey() {
        return crypto.randomBytes(32);
    }

    generateRandomIndex() {
        const range = BigInt(this.max) + 1n;
        const bitLen = 256n;
        const maxDraw = (1n << bitLen) - 1n;
        const threshold = (maxDraw / range) * range;
        while (true) {
            const randBytes = crypto.randomBytes(32);
            const randInt = BigInt('0x' + randBytes.toString('hex'));
            if (randInt < threshold) {
                return Number(randInt % range);
            }
        }
    }

    computeHMAC(index, key) {
        const h = crypto.createHmac('sha3-256', key);
        h.update(Buffer.from(index.toString()));
        return h.digest('hex');
    }
    // commit: returns HMAC, stores key & index
    commit() {
        this.key = this.generateKey();
        this.index = this.generateRandomIndex();
        return this.computeHMAC(this.index, this.key);
    }
    // reveal: returns { index, key }
    reveal() {
        return { index: this.index, key: this.key };
    }
}

// --- NonTransitiveDiceSet for probability and comparison ---
class NonTransitiveDiceSet {
    constructor() {
        this.dice = {};
    }

    add(name, dice) {
        if (this.dice[name]) throw new Error(`Die '${name}' already exists.`);
        this.dice[name] = dice;
    }

    get(name) {
        const d = this.dice[name];
        if (!d) throw new Error(`Die '${name}' not found.`);
        return d;
    }

    compare(nameA, nameB, rounds = 10000) {
        const dieA = this.get(nameA);
        const dieB = this.get(nameB);

        let winsA = 0, winsB = 0, ties = 0;

        for (let i = 0; i < rounds; i++) {
            const rA = dieA.faces[Math.floor(Math.random() * 6)];
            const rB = dieB.faces[Math.floor(Math.random() * 6)];
            if (rA > rB) winsA++;
            else if (rB > rA) winsB++;
            else ties++;
        }

        return { winsA, winsB, ties };
    }
}

// --- ProbabilityCalculator & HelpTable ---
class ProbabilityCalculator {
    constructor(set) { this.set = set; }

    compute() {
        const names = Object.keys(this.set.dice);
        const table = {};

        names.forEach(a => {
            table[a] = {};

            names.forEach(b => {
                if (a === b) table[a][b] = null;
                else {
                    const r = this.set.compare(a, b, 5000);
                    table[a][b] = (r.winsA / (r.winsA + r.winsB + r.ties));
                }
            });
        });
        return table;
    }
}

class HelpTable {
    constructor(probData) { this.data = probData; }

    render() {
        const names = Object.keys(this.data);
        const table = new AsciiTable().setHeading('', ...names);
        names.forEach(a => {
            const row = [a];
            names.forEach(b => {
                if (a === b) row.push('-');
                else row.push((this.data[a][b] * 100).toFixed(2) + '%');
            });
            table.addRow(...row);
        });
        console.log(table.toString());
    }
}

// --- Game Flow ---
async function main() {
    const configs = parseDice();
    validateDice(configs);

    // Determine who goes first (0..1)
    console.log("\n-- Who Goes First? --");

    const firstGen = new FairRandomGenerator(1);
    const commit0 = firstGen.commit();

    console.log(`HMAC: ${commit0}`);

    let user0 = await getUserInput('Guess 0 or 1: ', 2);

    if (user0 === '?') {
        console.log('Help: type 0 or 1 to guess.');
        process.exit(0);
    }

    const rev0 = firstGen.reveal();

    console.log(`Reveal: index=${rev0.index}, key=${rev0.key.toString('hex')}`);

    const v0 = firstGen.computeHMAC(rev0.index, rev0.key);

    if (v0 !== commit0) { console.log('Verification failed.'); process.exit(1); }

    const first = ((Number(user0) + rev0.index) % 2 === 0) ? 'User' : 'Computer';

    console.log(`${first} goes first.`);

    // Register dice
    const diceSet = new NonTransitiveDiceSet();
    configs.forEach((c, i) => {
        diceSet.add(`D${i + 1}`, new Die(c.split(',').map(Number)));
    });
    const names = Object.keys(diceSet.dice);

    // Help table precompute
    const prob = new ProbabilityCalculator(diceSet).compute();

    // Dice selection
    console.log(`\n-- Dice Selection --`);
    let userDie, compDie;
    if (first === 'User') {
        let choice = await getUserInput(names.map((n, i) => `${i}:${n}`).join('\n') + "\n? - help\nx - exit\nYour pick: ", names.length);
        if (choice === '?') { new HelpTable(prob).render(); process.exit(0); }
        userDie = names[choice];
        compDie = names.find(n => n !== userDie);
        console.log(`Computer picks ${compDie}`);
    } else {
        compDie = names[Math.floor(Math.random() * names.length)];
        console.log(`Computer picks ${compDie}`);
        const remain = names.filter(n => n !== compDie);
        let choice = await getUserInput(remain.map((n, i) => `${i}:${n}`).join('\n') + "\n? - help\nx - exit\nYour pick: ", remain.length);
        if (choice === '?') { new HelpTable(prob).render(); process.exit(0); }
        userDie = remain[choice];
    }
    console.log(`User picks ${userDie}`);

    // Single battle with provable fairness per roll
    console.log("\n-- Battle: Computer rolls first --");
    // computer roll commit
    const genC = new FairRandomGenerator(5);
    const commitC = genC.commit(); console.log(`Comp HMAC: ${commitC}`);
    const userR = await getUserInput('Your secret (0-5): ', 6);
    const revC = genC.reveal(); console.log(`Comp reveal: idx=${revC.index}, key=${revC.key.toString('hex')}`);
    const idxC = (revC.index + Number(userR)) % 6;
    console.log(`Comp rolled: ${diceSet.get(compDie).getFace(idxC)}`);

    console.log("\n-- Battle: You roll --");
    const genU = new FairRandomGenerator(5);
    const commitU = genU.commit(); console.log(`User HMAC: ${commitU}`);
    const compR = genC.generateRandomIndex(); // or fresh commit
    console.log(`Computer secret this time: hidden`);
    const revU = genU.reveal(); console.log(`User reveal: idx=${revU.index}, key=${revU.key.toString('hex')}`);
    const idxU = (revU.index + compR) % 6;
    console.log(`You rolled: ${diceSet.get(userDie).getFace(idxU)}`);

    // Determine
    const valC = diceSet.get(compDie).getFace(idxC);
    const valU = diceSet.get(userDie).getFace(idxU);
    if (valC > valU) console.log("I win.");
    else if (valU > valC) console.log("You win.");
    else console.log("Tie.");

    process.exit(0);
}

main();