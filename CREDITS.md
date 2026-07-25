# Credits

All code, page text, and artwork in this repository are original work by
Dimitres Kisimov (2026), written specifically for this project.

- No third-party libraries, frameworks, or code snippets.
- No third-party fonts (system font stack only).
- No third-party icons, images, or other assets. The app icon
  (`icons/icon.svg` and the PNGs derived from it by `tools/make_icons.py`)
  is an original drawing of a Bloch sphere made for this project.
- The seeded PRNG in `sim.js` implements the well-known public-domain
  mulberry32 algorithm from its published constants.

## Reference material consulted for the physics content

The lessons cite these sources in the app footer and in README.md:

1. M. A. Nielsen and I. L. Chuang, *Quantum Computation and Quantum
   Information*, Cambridge University Press (10th anniversary edition, 2010).
2. J. Preskill, "Quantum Computing in the NISQ era and beyond",
   Quantum 2, 79 (2018). arXiv:1801.00862.
3. IBM Quantum Learning, learning.quantum.ibm.com.
4. C. Gidney and M. Ekerå, Quantum 5, 433 (2021). arXiv:1905.09749.
5. C. H. Bennett, E. Bernstein, G. Brassard and U. Vazirani,
   SIAM J. Comput. 26, 1510 (1997). arXiv:quant-ph/9701001.
6. P. W. Shor, SIAM J. Comput. 26, 1484 (1997). arXiv:quant-ph/9508027.
7. L. K. Grover, Proc. 28th ACM STOC (1996). arXiv:quant-ph/9605043.

No text was copied from these sources; they were used to keep the claims,
asymptotics, and caveats accurate.
