# Wheelbase words vs L codes

The same word maps to different L codes on different makes, so SWB/MWB/LWB fill
Length only for the models below (D-059; the code copy is
`normalise.WHEELBASE_LENGTHS`). Change one, change the other.

| Make / model                | SWB | MWB | LWB | Extra long | Source |
| --------------------------- | --- | --- | --- | ---------- | ------ |
| Ford Transit (2014-on)      | L2  | L3  | L4  | —          | checked |
| Renault Master (2010-on)    | L1  | L2  | L3  | L4 (some)  | checked (L1–L3) |
| Vauxhall / Opel Movano      | L1  | L2  | L3  | L4 (some)  | Master twin, not checked |
| Fiat Ducato / Peugeot Boxer / Citroën Relay | L1 | L2 | L3 | L4 | matches stored listings (D-059) |
| Nissan NV400 / Interstar    | L1  | L2  | L3  | L4 (some)  | Master twin; matches stored listings |

## Wheelbase and overall length (mm)

Models that share a shell are grouped; the numbers are identical across the group.
Wheelbase is axle to axle; overall length is bumper to bumper (van body, no tow bar).

| Shell | Models | Spec | L1 | L2 | L3 | L4 |
| ----- | ------ | ---- | -- | -- | -- | -- |
| Ford Transit (2014-on) | Transit | Wheelbase | — | 3300 | 3750 | 3750 (long rear overhang) |
| | | Overall length | — | 5531–5585 | 5981 | 6703–6704 |
| Renault Master (2010-on) | Master, Vauxhall / Opel Movano, Nissan NV400, Renault Interstar | Wheelbase | 3182 | 3682 | 4332 | 4332 (long rear overhang) |
| | | Overall length | 5048 | 5548 | 6198 | 6848 (Master / Movano only; no NV400 L4 listed) |
| Fiat Ducato | Ducato, Peugeot Boxer, Citroën Relay | Wheelbase | 3000 | 3450 | 3800 | 4035 |
| | | Overall length | 4963 | 5413 | 5998 | 6363 |

Notes:

- Transit L2 length differs between sources (5531 in Ford's own figures, 5585 on
  vandimensions, which labels its lengths L1–L3). Wheelbases agree. The Transit has no L1.
- The Master-shell L4 length (6848) appears on one source only (the Movano page) and
  the Master L4 is rear-wheel-drive only. Treat it as unconfirmed.
- Sources disagree on Ducato L2/L3 wheelbases (some give 3120, or 4035 for both L3 and
  L4). The 3000 / 3450 / 3800 / 4035 set is the one vandimensions lists for Ducato and
  Relay.
- Older Ducato/Boxer/Relay (pre-2006) and pre-2014 Transit have different sizes; not covered.

Sources: [Ford Transit dimensions](https://www.vanguide.co.uk/?p=1480),
[Transit 2014-on](https://vandimensions.com/database/ford/transit-2014),
[Renault Master dimensions](https://vanreviewer.co.uk/renault/master/dimensions/3569/),
[Master RWD](https://vandimensions.com/database/renault/master-2010-rwd),
[Movano 2014-on](https://vandimensions.com/database/opel/movano-2014),
[Nissan NV400](https://vandimensions.com/database/nissan/nv400-2010),
[Citroën Relay](https://vandimensions.com/database/citroen/relay),
[Fiat Ducato](https://vandimensions.com/database/Fiat/ducato-2011).
