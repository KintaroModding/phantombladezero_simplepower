"use strict";
// Simple Power for Phantom Blade Zero: a PBZModLoader mod (ProjectPBZ/PBZModLoader/mods/phantombladezero_simplepower/).
//
// The player's attacks deal more health damage (attribute Attack) and more Sha-Chi damage (attribute ShachiAttack), and
// the player's parries deal more Sha-Chi damage (attribute Amplification_ReflectShachi), each with its own
// multiplier. Parries need their own: the game takes a share of the enemy's Sha-Chi bar there, without ShachiAttack. The mod puts the game's own timed attribute effects GE_MA_Attack_0_Mul, GE_MA_ShachiAttack_0_Mul
// (operation Multiplicitive) and GE_MA_Amplification_ReflectShachi_0_Add (operation Additive: the amplification is a
// share on top, 0 in the game, 0.5 = 50% more, as the game's own Sha-Chi accessory adds 0.05 or 0.1) on the player
// character's ability system, all HasDuration with the SetByCaller magnitude "AttributeOpMagnitude", the way Faster
// Movement does it for the movement speeds. A timed effect changes the attribute's current value only: base values, and
// so the save, stay the game's own. Enemies get no effect.
// The poll puts an effect back when the game cleared it (death, load) and replaces it when its multiplier changes.
//
// PBZModLoader loads this file after the game's MainStart, through the game's module system: require("ue"),
// require("puerts") and require("Library/TsHelper") are the game's modules. Before a reload (Alt+F5) it awaits stop(),
// which takes the effects off (restore()).
// Settings: phantombladezero_simplepower.txt next to this file (__dirname), "Key=Value" lines (; or # starts a comment,
// the first line of a key wins), read every SETTINGS_MS and written with the defaults when missing. With Mods Menu
// (0.9.0 or later) running, the mod adds its page there and reads the file that page saves instead (a page cannot save
// anywhere else).
const UE = require("ue");
const puerts = require("puerts");

const MOD_NAME = "Simple Power";
const MOD_ID = "phantombladezero_simplepower"; // the mod folder's name and Mods Menu's page id
const MOD_VERSION = "1.2";
const POLL_MS = 500;
const SETTINGS_MS = 2000;
const SETTINGS_FILE = MOD_ID + ".txt";
const MULTIPLIER_MIN = 0.1, MULTIPLIER_MAX = 10, MULTIPLIER_DEFAULT = 1.5;
// Timed, never 0: a duration of 0 or less might fall back to the instant effect (_1_), which writes the base value.
const EFFECT_SECONDS = 1000000;
// A poll that throws is tried again (a level load can free an object halfway); this many in a row end the mod.
const MAX_ERRORS = 10;
// loader.log takes a limited number of lines: at most this many about the effects per start.
const MAX_LOGS = 30;
// Each setting (a multiplier m): its attribute (UBasicAttributeSet), the operation of the game's effect, the magnitude
// for m, and the attribute that is above 0 once the game set the character up (an amplification is 0 in the game).
const POWERS = [
    { setting: "Attack", attribute: "Attack", op: "Mul", magnitude: (m) => m, ready: "Attack" },
    { setting: "ShaChiAttack", attribute: "ShachiAttack", op: "Mul", magnitude: (m) => m, ready: "ShachiAttack" },
    { setting: "ParryShaChi", attribute: "Amplification_ReflectShachi", op: "Add", magnitude: (m) => m - 1, ready: "Attack" },
];
const effectName = (power) => `GE_MA_${power.attribute}_0_${power.op}`;
const effectPath = (power) => `/PBZCombatAsset/Config/AttributesModifyEffect/${effectName(power)}.${effectName(power)}`;
// Every setting with its default; the shipped settings file holds exactly this text (tests/test_mod.js checks it).
const DEFAULT_TEXT = ["; " + MOD_NAME + " settings. Change a value and save; the game picks it up within 2 seconds.",
    "; Enable: On, or Off (the mod does nothing).",
    "Enable=On",
    "; Attack: the health damage you deal, 0.1 to 10. 1 = the game's own, 1.5 = 50% more, 2 = double.",
    "Attack=1.5",
    "; ShaChiAttack: the Sha-Chi damage your hits deal, 0.1 to 10. 1 = the game's own, 1.5 = 50% more, 2 = double.",
    "ShaChiAttack=1.5",
    "; ParryShaChi: the Sha-Chi damage your parries deal, 0.1 to 10. 1 = the game's own, 2 = double.",
    "ParryShaChi=1.5", ""].join("\r\n");

// The running poll, its GameInstance, the settings file, the settings, polls that threw in a row, lines logged; off:
// the mod ended itself at once (a base value moved).
const run = { timer: undefined, ctx: undefined, path: undefined, readAt: -Infinity, made: false, errors: 0, logs: 0,
    off: false, settings: { enable: true, Attack: MULTIPLIER_DEFAULT, ShaChiAttack: MULTIPLIER_DEFAULT,
        ParryShaChi: MULTIPLIER_DEFAULT } };
// Our effects: character path name -> { asc, buffs: { setting: { m, handle } } }. A string key, so a new JS wrapper
// for the same actor cannot get a second effect.
const players = new Map();
const effects = {};

// The Mods Menu page (optional): one row per setting, the same keys and defaults as DEFAULT_TEXT.
const page = () => ({ id: MOD_ID, title: MOD_NAME, version: MOD_VERSION, file: SETTINGS_FILE, store: "saved",
    description: { en: "Your attacks deal more health and Sha-Chi damage, your parries more Sha-Chi damage. Enemies are not changed." },
    settings: [
        { key: "Enable", type: "toggle", label: "Enable", default: true, help: "Off: the mod does nothing." },
        { key: "Attack", type: "number", label: "Attack", min: MULTIPLIER_MIN, max: MULTIPLIER_MAX, step: 0.1,
            default: MULTIPLIER_DEFAULT, help: "The health damage you deal. 1 is the game's own, 2 is double." },
        { key: "ShaChiAttack", type: "number", label: "Sha-Chi Attack", min: MULTIPLIER_MIN, max: MULTIPLIER_MAX,
            step: 0.1, default: MULTIPLIER_DEFAULT,
            help: "The Sha-Chi damage your hits deal. 1 is the game's own, 2 is double." },
        { key: "ParryShaChi", type: "number", label: "Parry Sha-Chi", min: MULTIPLIER_MIN, max: MULTIPLIER_MAX,
            step: 0.1, default: MULTIPLIER_DEFAULT,
            help: "The Sha-Chi damage your parries deal. 1 is the game's own, 2 is double." },
    ],
    onChange: () => { run.readAt = -Infinity; } }); // the next poll reads the file
// PBZModLoader starts its mods after Mods Menu's, so a running Mods Menu has its registry object here by now. Without it
// nothing is pushed: an array left for a Mods Menu that starts later would give a page that saves another file.
const menu = { on: false };
{
    const mm = globalThis.PBZModsMenu;
    if (mm && typeof mm === "object" && !Array.isArray(mm) && typeof mm.push === "function"
        && typeof mm.settingsPath === "function" && mm.api && typeof mm.api.has === "function"
        && mm.api.has("settingsPath") && mm.api.has("store.saved")) {
        try {
            mm.push(page());
            menu.on = typeof mm.settingsPath(MOD_ID) === "string";
        }
        catch (e) {
            console.warn(`[${MOD_NAME}] no Mods Menu page: ${e}`);
        }
    }
}

// The settings file: the one Mods Menu's page saves, else the one next to this main.js.
function settingsPath() {
    if (menu.on) {
        const path = globalThis.PBZModsMenu.settingsPath(MOD_ID);
        if (typeof path === "string" && path)
            return path;
    }
    return UE.KismetSystemLibrary.ConvertToAbsolutePath(String(__dirname).replace(/[\\/]+$/, "") + "/" + SETTINGS_FILE);
}

// The value of `key` in the settings text, in lower case ("" when the key is missing).
function readKey(text, key) {
    const re = new RegExp("^[ \\t]*" + key + "[ \\t]*=[ \\t]*([^;#\\r\\n]*?)[ \\t]*(?:[;#][^\\r\\n]*)?$", "i");
    for (const line of text.split(/\r?\n/)) {
        const m = re.exec(line);
        if (m)
            return m[1].toLowerCase();
    }
    return "";
}

// A multiplier from the settings text, also "1,5" and "x2", clamped: the default when the key is missing or empty, the
// last value when it is not a number.
function readMultiplier(text, key, last) {
    const value = readKey(text, key);
    if (value === "")
        return MULTIPLIER_DEFAULT;
    const m = /^x?[ \t]*([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))$/.exec(value);
    return m ? Math.min(MULTIPLIER_MAX, Math.max(MULTIPLIER_MIN, parseFloat(m[1].replace(",", ".")))) : last;
}

// Reads the settings file at most every SETTINGS_MS. A file that cannot be read keeps the last settings.
function readSettings() {
    if (Math.abs(Date.now() - run.readAt) < SETTINGS_MS)
        return;
    run.readAt = Date.now();
    try {
        run.path = run.path || settingsPath();
        let text = "";
        if (UE.BlueprintPathsLibrary.FileExists(run.path)) { // check first: EasyCsv logs an error for a missing file
            const out = puerts.$ref("");
            if (!UE.EasyCsv.LoadStringFromLocalFile(run.path, out))
                return; // locked mid-save, or 10 characters or fewer: keep the last settings
            text = String(puerts.$unref(out)).replace(/^﻿/, "");
        }
        else if (!run.made) {
            run.made = true; // once a session, and never over an existing file
            UE.EasyCsv.SaveStringToFileWithFullPath(DEFAULT_TEXT, run.path);
        }
        run.settings.enable = !["off", "0", "no", "false"].includes(readKey(text, "Enable"));
        for (const { setting } of POWERS)
            run.settings[setting] = readMultiplier(text, setting, run.settings[setting]);
    }
    catch (e) {
        console.warn(`[${MOD_NAME}] settings not read: ${e}`);
    }
}

// Puerts throws for an object the game freed, also inside IsValid.
function valid(object) {
    try {
        return !!object && UE.KismetSystemLibrary.IsValid(object);
    }
    catch (e) {
        return false;
    }
}

const alive = (buff) => UE.AbilitySystemBlueprintLibrary.GetActiveGameplayEffectStackCount(buff.handle) > 0;
const attribute = (name) => UE.PBZBlueprintFunctionLibrary.MakeAttribute(name, UE.BasicAttributeSet.StaticClass());
const baseValue = (character, attr) =>
    UE.AbilitySystemBlueprintLibrary.GetFloatAttributeBase(character, attr, puerts.$ref(false));
const currentValue = (character, attr) => UE.PBZBlueprintFunctionLibrary.GetAttributeFromCharacter(character, attr);
const shown = (value) => String(+value.toFixed(2));

function log(message) {
    if (run.logs++ < MAX_LOGS)
        console.log(`[PBZMOD] [${MOD_NAME}] ${message}`);
}

// Takes one effect off. Its record goes only when the effect is gone, so a call that throws is tried again.
function remove(record, name) {
    const buff = record.buffs[name];
    if (!buff)
        return;
    if (alive(buff)) {
        record.asc.RemoveActiveGameplayEffect(buff.handle, -1);
        if (alive(buff))
            throw new Error(`the game did not take the ${name} effect off`);
    }
    delete record.buffs[name];
}

// Puts one power's effect on the player, replaces it, or takes it off (a multiplier of 1).
function apply(character, record, power, m) {
    const name = power.setting;
    const old = record.buffs[name];
    if (old ? old.m === m && alive(old) : m === 1)
        return;
    remove(record, name); // the multiplier changed, or the game cleared ours: never two at once
    const attr = attribute(power.attribute);
    const before = currentValue(character, attr);
    if (m === 1) {
        log(`${name}: the game's own, ${power.attribute} ${shown(before)}`);
        return;
    }
    if (!(currentValue(character, attribute(power.ready)) > 0))
        return; // the character's attributes are not set up yet (spawn, load): the next poll tries again
    const effect = effects[name] = effects[name] || UE.Object.Load(effectPath(power));
    if (!effect)
        throw new Error(`the game's effect ${effectName(power)} is missing`);
    const ASC = UE.AbilitySystemBlueprintLibrary;
    const base = baseValue(character, attr);
    // AttributeUtils.AddAttributeBuff ran as an instant effect in game (Faster Movement's source), so the timed spec is
    // built by hand: the game's own HasDuration effect, SetByCaller magnitude, locked duration.
    let spec = ASC.MakeSpecHandle(effect, character, character, 1);
    spec = ASC.AssignSetByCallerMagnitude(spec, "AttributeOpMagnitude", power.magnitude(m));
    spec = ASC.SetDuration(spec, EFFECT_SECONDS);
    const buff = record.buffs[name] = { m, handle: record.asc.BP_ApplyGameplayEffectSpecToSelf(spec) };
    if (baseValue(character, attr) !== base) {
        // The effect landed on the base value, which the save may keep and the next poll would multiply again: put the
        // base back and end the mod for this session.
        run.off = true;
        UE.AttributeUtils.ModifyCharacterAttributeValue(character, attr, UE.EGameplayModOp.Override, base);
        throw new Error(`${power.attribute}: the base value moved from ${shown(base)} and was put back`);
    }
    if (!alive(buff)) {
        delete record.buffs[name]; // the game refused it: the next poll tries again
        return;
    }
    log(`${name} x${m}: ${power.attribute} ${shown(before)} -> ${shown(currentValue(character, attr))}`);
}

// Puts the wanted effects on the player character, once per poll.
function step(ctx) {
    const character = UE.GameplayStatics.GetPlayerCharacter(ctx, 0);
    if (!valid(character))
        return;
    const asc = UE.AbilitySystemBlueprintLibrary.GetAbilitySystemComponent(character);
    if (!valid(asc))
        return; // not set up yet (spawn, load): the next poll tries again
    for (const [key, record] of players)
        if (!valid(record.asc))
            players.delete(key); // that character is gone, and its effects with it
    const key = UE.KismetSystemLibrary.GetPathName(character);
    let record = players.get(key);
    if (!record)
        players.set(key, record = { asc, buffs: {} });
    record.asc = asc; // a new character can have an old one's path name; the old handles are then no longer alive
    for (const power of POWERS)
        apply(character, record, power, run.settings[power.setting]);
}

// Takes every effect off (Enable=Off, stop(), an error). An effect that stays keeps its record for the next try; the
// first error is thrown once all were tried.
function restore() {
    let problem = undefined;
    for (const [key, record] of players) {
        if (!valid(record.asc)) {
            players.delete(key);
            continue;
        }
        for (const name of Object.keys(record.buffs)) {
            try {
                remove(record, name);
            }
            catch (e) {
                problem = problem || e;
            }
        }
        if (Object.keys(record.buffs).length === 0)
            players.delete(key);
    }
    if (problem)
        throw problem;
}

function poll() {
    readSettings();
    try {
        if (run.settings.enable)
            step(run.ctx);
        else
            restore();
        run.errors = 0;
    }
    catch (e) {
        if (++run.errors < MAX_ERRORS && !run.off)
            return; // a level load can free an object between two calls: the next poll tries again
        // a class or function is gone after a game update: stop for the session and leave the game as it is
        clearInterval(run.timer);
        run.timer = undefined;
        console.warn(`[${MOD_NAME}] stopped: ${e}`);
        try { restore(); } catch (e2) { }
    }
}

// Start at once. A start that fails throws, so PBZModLoader logs the mod as failed.
try {
    run.ctx = puerts.argv.getByName("GameInstance");
    if (!run.ctx)
        throw new Error("the GameInstance is missing");
    readSettings();
    run.timer = setInterval(poll, POLL_MS);
    console.log(`[PBZMOD] [${MOD_NAME}] ${MOD_VERSION} started; settings: ${run.path}` + (menu.on ? " (Mods Menu's page)" : ""));
}
catch (e) {
    console.warn(`[${MOD_NAME}] not started: ${e}`);
    throw e;
}

exports.stop = function () {
    if (run.timer !== undefined)
        clearInterval(run.timer);
    run.timer = undefined;
    try {
        restore();
    }
    catch (e) {
        console.warn(`[${MOD_NAME}] stop: ${e}`);
    }
    console.log(`[PBZMOD] [${MOD_NAME}] stopped`);
};
