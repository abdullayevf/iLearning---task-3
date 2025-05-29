#!/usr/bin/env node
import crypto from "node:crypto";
import readline from "readline";
import AsciiTable from "ascii-table";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getUserInput(prompt, maxOption) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(prompt, (answer) => {
            rl.close();
            const t = answer.trim();
            if (t.toUpperCase() === "X") {
                console.log("Exiting. Farewell, mortal.");
                process.exit(0);
            }
            if (t === "?") {
                resolve("?");
            } else if (maxOption !== undefined) {
                const n = parseInt(t, 10);
                if (isNaN(n) || n < 0 || n >= maxOption) {
                    console.log("Invalid selection.");
                    process.exit(1);
                }
                resolve(n);
            } else {
                resolve(t);
            }
        });
    });
}

// ─── Step 1 & 2: parse + validate ────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length < 3) {
    console.log("Error: at least 3 dice configurations required.");
    console.log("Example: node game.js 2,2,4,4,9,9 6,8,1,1,8,6 7,5,3,7,5,3");
    process.exit(1);
}
args.forEach(cfg => {
    const parts = cfg.split(",");
    if (parts.length !== 6 || parts.some(p => !/^[-]?\d+$/.test(p))) {
        console.log(`Error: invalid dice config '${cfg}'. Must be 6 comma-separated integers.`);
        process.exit(1);
    }
});

// ─── Die + RNG Classes ────────────────────────────────────────────────────────

class Die {
    constructor(faces) {
        this.faces = faces;
    }
    face(index) {
        return this.faces[index];
    }
}

class FairRandomGenerator {
    constructor(max) { this.max = max; }
    generateKey() {
        return crypto.randomBytes(32);
    }
    generateIndex() {
        const range = BigInt(this.max) + 1n;
        const maxDraw = (1n << 256n) - 1n;
        const threshold = (maxDraw / range) * range;
        while (true) {
            const rnd = BigInt("0x" + crypto.randomBytes(32).toString("hex"));
            if (rnd < threshold) return Number(rnd % range);
        }
    }
    computeHMAC(idx, key) {
        const h = crypto.createHmac("sha3-256", key);
        h.update(Buffer.from(idx.toString()));
        return h.digest("hex");
    }
    commit() {
        this.key = this.generateKey();
        this.idx = this.generateIndex();
        return this.computeHMAC(this.idx, this.key);
    }
    reveal() {
        return { idx: this.idx, key: this.key };
    }
}

// ─── Non-Transitive Set + Probability Table ─────────────────────────────────

class NonTransitiveDiceSet {
    constructor() { this.dice = {}; }
    add(name, die) {
        this.dice[name] = die;
    }
    get(name) {
        return this.dice[name];
    }
    compare(a, b, rounds = 10000) {
        const da = this.get(a), db = this.get(b);
        let wA = 0, wB = 0, ties = 0;
        for (let i = 0; i < rounds; i++) {
            const rA = da.face(Math.floor(Math.random() * 6));
            const rB = db.face(Math.floor(Math.random() * 6));
            if (rA > rB) wA++; else if (rB > rA) wB++; else ties++;
        }
        return { wA, wB, ties };
    }
}

class ProbabilityCalculator {
    constructor(set) { this.set = set; }
    compute() {
        const names = Object.keys(this.set.dice);
        const table = {};
        names.forEach(a => {
            table[a] = {};
            names.forEach(b => {
                table[a][b] = (a === b)
                    ? null
                    : this.set.compare(a, b, 5000).wA /
                    (this.set.compare(a, b, 5000).wA + this.set.compare(a, b, 5000).wB + this.set.compare(a, b, 5000).ties);
            });
        });
        return table;
    }
}

class HelpTable {
    constructor(data) { this.data = data; }
    render() {
        const names = Object.keys(this.data);
        const tbl = new AsciiTable().setHeading("", ...names);
        names.forEach(a => {
            const row = [a];
            names.forEach(b => {
                row.push(a === b ? "-" : (this.data[a][b] * 100).toFixed(2) + "%");
            });
            tbl.addRow(...row);
        });
        console.log(tbl.toString());
    }
}

// ─── Game Flow ────────────────────────────────────────────────────────────────

(async function main() {
    // 1) Who goes first
    console.log("Let's determine who makes the first move.");
    const coin = new FairRandomGenerator(1);
    const cHMAC = coin.commit();
    console.log(`I selected a random value in the range 0..1 (HMAC=${cHMAC}).`);
    console.log("Try to guess my selection.\n0 - 0\n1 - 1\nX - exit\n? - help");
    let u0 = await getUserInput("Your selection: ", 2);
    if (u0 === "?") { console.log("Enter 0 or 1 to guess."); process.exit(0); }
    const cr = coin.reveal();
    console.log(`My selection: ${cr.idx} (KEY=${cr.key.toString("hex")}).`);
    if (coin.computeHMAC(cr.idx, cr.key) !== cHMAC) {
        console.log("Commitment verification failed."); process.exit(1);
    }
    const first = ((Number(u0) + cr.idx) % 2 === 0) ? "User" : "Computer";
    console.log(`${first} make the first move.`);

    // 2) Build dice set
    const diceSet = new NonTransitiveDiceSet();
    args.forEach((cfg, i) => {
        diceSet.add(`[${cfg}]`, new Die(cfg.split(",").map(Number)));
    });
    const names = Object.keys(diceSet.dice);

    // 3) Precompute help
    const probData = new ProbabilityCalculator(diceSet).compute();

    // 4) Dice selection
    console.log("Choose your dice:");
    let userDie, compDie;
    if (first === "User") {
        console.log(names.map((n, i) => `${i} - ${n}`).join("\n") + "\nX - exit\n? - help");
        let c = await getUserInput("Your selection: ", names.length);
        if (c === "?") { new HelpTable(probData).render(); process.exit(0); }
        userDie = names[c];
        compDie = names.find(n => n !== userDie);
        console.log(`I make the first move and choose the ${compDie} dice.`);
        console.log(`You choose the ${userDie} dice.`);
    } else {
        compDie = names[Math.floor(Math.random() * names.length)];
        console.log(`I make the first move and choose the ${compDie} dice.`);
        const rem = names.filter(n => n !== compDie);
        console.log(rem.map((n, i) => `${i} - ${n}`).join("\n") + "\nX - exit\n? - help");
        let c = await getUserInput("Your selection: ", rem.length);
        if (c === "?") { new HelpTable(probData).render(); process.exit(0); }
        userDie = rem[c];
        console.log(`You choose the ${userDie} dice.`);
    }

    // 5) Computer's roll
    console.log("It's time for my roll.");
    const genC = new FairRandomGenerator(5);
    const hC = genC.commit();
    console.log(`I selected a random value in the range 0..5 (HMAC=${hC}).`);
    console.log("Add your number modulo 6.\n0 - 0\n1 - 1\n2 - 2\n3 - 3\n4 - 4\n5 - 5\nX - exit\n? - help");
    let u1 = await getUserInput("Your selection: ", 6);
    if (u1 === "?") { new HelpTable(probData).render(); process.exit(0); }
    const revC = genC.reveal();
    console.log(`My number is ${revC.idx} (KEY=${revC.key.toString("hex")}).`);
    const idxC = (revC.idx + Number(u1)) % 6;
    console.log(`The fair number generation result is ${revC.idx} + ${u1} = ${idxC} (mod 6).`);
    console.log(`My roll result is ${diceSet.get(compDie).face(idxC)}.`);

    // 6) User's roll
    console.log("It's time for your roll.");
    const genU = new FairRandomGenerator(5);
    const hU = genU.commit();
    console.log(`I selected a random value in the range 0..5 (HMAC=${hU}).`);
    console.log("Add your number modulo 6.\n0 - 0\n1 - 1\n2 - 2\n3 - 3\n4 - 4\n5 - 5\nX - exit\n? - help");
    let u2 = await getUserInput("Your selection: ", 6);
    if (u2 === "?") { new HelpTable(probData).render(); process.exit(0); }
    const revU = genU.reveal();
    console.log(`My number is ${revU.idx} (KEY=${revU.key.toString("hex")}).`);
    const idxU = (revU.idx + Number(u2)) % 6;
    console.log(`The fair number generation result is ${revU.idx} + ${u2} = ${idxU} (mod 6).`);
    console.log(`Your roll result is ${diceSet.get(userDie).face(idxU)}.`);

    // 7) Winner
    const vC = diceSet.get(compDie).face(idxC);
    const vU = diceSet.get(userDie).face(idxU);
    if (vC > vU) console.log("I win (" + vC + " > " + vU + ").");
    else if (vU > vC) console.log("You win (" + vU + " > " + vC + ").");
    else console.log("Tie (" + vU + " = " + vC + ").");

    process.exit(0);
})();