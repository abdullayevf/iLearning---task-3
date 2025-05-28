# Non-Transitive Dice Game — iLearning Task 3

This is a secure, console-based implementation of a generalized non-transitive dice game developed as part of the iLearning Task 3 challenge. The game supports:

- Any number of dice with 6 sides each
- Interactive two-player mode
- Secure commit-reveal scheme to determine who goes first
- Cryptographically fair die rolls using HMAC and SHA-256
- An optional help table displaying win probabilities between each die

## Features

- **Commit-Reveal Mechanism**: Ensures fairness by hiding player choices and enforcing a secure reveal step.
- **Provably Fair Randomness**: Each die roll is tied to a cryptographic key and seed, which is revealed post-roll.
- **Probability Matrix**: Displays a matrix of pairwise win probabilities across all dice in the set.
- **Validation**: Gracefully handles invalid inputs, including malformed dice sets and parameter errors.

## How to Run

```bash
node main.js [DICE_SET]
