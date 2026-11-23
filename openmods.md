# Simple Power

Your hits deal more health and Sha-Chi damage, your parries more Sha-Chi damage: one multiplier each, only for you. A PBZModLoader mod, live settings.

## What it does

Your attacks and parries are stronger. Three multipliers, each from 0.1 to 10, set live:

- **Attack:** the health damage you deal (x1.5 as installed).
- **Sha-Chi Attack:** the Sha-Chi damage your hits deal, so enemies break sooner (x1.5 as installed).
- **Parry Sha-Chi:** the Sha-Chi damage your parries deal (x1.5 as installed). A held block deals none, so nothing
  changes there.

Only your character gets stronger. Enemies are not changed: their health, their Sha-Chi and their damage stay the
game's own.

It is a PBZModLoader mod: a script in the game's own script engine. It replaces no game file and writes nothing into
the save: it puts three of the game's own timed effects on your character, on top of your stock values, so with the mod
removed you are back to stock.

## Screenshots

![Simple Power](docs/cover.webp)

## How to install

1. Install [PBZModLoader](https://github.com/KintaroModding/phantombladezero_pbzmodloader) 2.1.0 or later.
2. Download the zip of the latest release on GitHub (`phantombladezero_simplepower_<version>.zip`).
3. Unpack it into the game folder (the folder that holds `ProjectPBZ`). It adds the folder
   `ProjectPBZ\PBZModLoader\mods\phantombladezero_simplepower\` with `main.js` and the settings file.
4. Start the game.

To check that it runs: `ProjectPBZ\PBZModLoader\loader.log` has the line
`[PBZMOD] [Simple Power] <version> started; settings: ...`.

To update the mod, replace `main.js` with the one of the new release; keep your settings file (a setting that it does
not have keeps its default). To remove the mod, delete the folder `ProjectPBZ\PBZModLoader\mods\phantombladezero_simplepower\`.

## How to use

Nothing to do: the mod works as soon as you load a game (x1.5 for all three).

To change the values, use the Mods Menu page or the settings file below. A change counts within a few seconds, without
a restart and without loading the save again.

## Settings

The settings are in `ProjectPBZ\PBZModLoader\mods\phantombladezero_simplepower\phantombladezero_simplepower.txt`. Open it with a text editor,
change a value and save: the mod reads the file every 2 seconds, so the game uses it without a restart. Without the
file the mod writes it with the defaults below. Keys are not case-sensitive; `;` or `#` starts a comment.

**With Mods Menu** (0.9.0 or later) in the game, the mod adds its page to Mods Menu's tab in the game's settings, and
the page's settings are the ones that count: Mods Menu keeps them in its own file in the game's `Saved` folder, and
the file in the mod's folder is not read then.

| Setting | Default | What it does |
|---|---|---|
| `Enable` | `On` | `Off`: the mod does nothing, the game's values come back |
| `Attack` | `1.5` | The health damage you deal, 0.1 to 10 (1 = the game's own, 1.5 = 50% more, 2 = double) |
| `ShaChiAttack` | `1.5` | The Sha-Chi damage your hits deal, 0.1 to 10 (1 = the game's own, 1.5 = 50% more, 2 = double) |
| `ParryShaChi` | `1.5` | The Sha-Chi damage your parries deal, 0.1 to 10 (1 = the game's own, 1.5 = 50% more, 2 = double) |

## Compatibility

- Game version: Steam build 26367565 (`CL-302256_JKS-17280`).
- Needs PBZModLoader 2.1.0 or later. Mods Menu is optional.
- [Phantom Tuner](https://github.com/KintaroModding/phantombladezero_phantomtuner) has its own `PlayerAttack` and
  `PlayerShaChiAttack`. Both can run together: the values then multiply (x1.5 here and x2 there give x3). Nothing loops
  or grows by itself. Use the one you prefer, or set the other to 1.
- [Heaven or Hell](https://github.com/KintaroModding/phantombladezero_heavenorhell) writes your attack directly while
  it runs, so `Attack` here does not show next to it. Set `Attack=1` and use only `ShaChiAttack`.
- Another mod that changes the player's attack or Sha-Chi attack: test them together.

## Known issues

- None known.

## How to build

There is nothing to build: `src\phantombladezero_simplepower\` is the mod folder (`main.js` and the settings file).
`tests\test_mod.js` runs the script outside the game with Node.js and stand-ins for the game: `node tests\test_mod.js`.
`README.md` has the details.

## Credits

Made by Kintaro. MIT license: you may use, change and share this mod. PBZModLoader is made by LKF, its fork by
KintaroModding. Phantom Blade Zero and its files belong to their makers.
