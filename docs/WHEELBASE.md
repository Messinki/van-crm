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

## Wheelbases (mm)

| Model          | L1   | L2   | L3   | L4   |
| -------------- | ---- | ---- | ---- | ---- |
| Ford Transit   | —    | 3300 | 3750 | 3750 (long rear overhang) |
| Renault Master | 3182 | 3682 | 4332 | —    |

Sources: [Ford Transit dimensions](https://www.vanguide.co.uk/?p=1480),
[Renault Master dimensions](https://vanreviewer.co.uk/renault/master/dimensions/3569/),
[Transit 2014-on](https://vandimensions.com/database/ford/transit-2014).
