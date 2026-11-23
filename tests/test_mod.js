// Offline test of the mod, run by build.ps1: node tests/test_mod.js
// It loads src/phantombladezero_simplepower/main.js as PBZModLoader does (a module whose __dirname is the mod's folder) with
// stand-ins for the modules the game gives it (ue, puerts, the game's TsHelper), an optional running Mods Menu and the
// settings file, drives the mod's poll and the clock by hand, and checks what the mod does.
"use strict";
const fs = require("fs");
const path = require("path");
const Module = require("module");

const FOLDER = path.join(__dirname, "..", "src", "phantombladezero_simplepower");
const SCRIPT = path.join(FOLDER, "main.js");
const SETTINGS = path.join(FOLDER, "phantombladezero_simplepower.txt");
// The mod's own settings path: __dirname of main.js and the file name (ConvertToAbsolutePath is a stand-in here).
const SETTINGS_PATH = FOLDER.replace(/[\\/]+$/, "") + "/phantombladezero_simplepower.txt";
const MENU_PATH = "C:/Game/ProjectPBZ/Saved/PBZModsMenu/Settings/phantombladezero_simplepower.txt";

let failed = 0;
function check(name, ok) {
    console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
    if (!ok) {
        failed++;
    }
}

// A running Mods Menu as the mod meets it (its registry object), or without the features named in `missing`.
function modsMenu(world, missing = []) {
    return {
        api: { has: (feature) => !missing.includes(feature) },
        push(...mods) { world.pushed.push(...mods); return world.pushed.length; },
        settingsPath: (id) => (world.pushed.some((m) => m.id == id) ? MENU_PATH : undefined),
    };
}

// The game's ability system as the mod meets it. A character holds base values and active effects; an attribute's
// current value is (its base + every added effect) x every multiplied one. A freed object throws in every call, as in Puerts.
function character(name, values = { Attack: 100, ShachiAttack: 80, Amplification_ReflectShachi: 0, Health: 850 }) {
    const c = { path: name, base: { ...values }, active: [], freed: false, removed: [] };
    c.asc = {
        owner: c,
        BP_ApplyGameplayEffectSpecToSelf(spec) {
            if (c.refuse) {
                return { on: false };
            }
            if (c.instant) {
                c.base[spec.attr] *= spec.m;
                return { on: false };
            }
            const handle = { on: true, attr: spec.attr, op: spec.op, m: spec.m, seconds: spec.seconds };
            c.active.push(handle);
            return handle;
        },
        RemoveActiveGameplayEffect(handle, stacks) {
            if (c.freed || c.stuck) {
                throw new Error("stuck");
            }
            c.removed.push([handle, stacks]);
            if (!c.keeps && c.active.includes(handle)) {
                handle.on = false;
                c.active.splice(c.active.indexOf(handle), 1);
            }
            return true;
        },
    };
    const sum = (attr) => c.active.filter((h) => h.attr == attr && h.op == "Add").reduce((v, h) => v + h.m, c.base[attr]);
    c.value = (attr) => c.active.filter((h) => h.attr == attr && h.op == "Mul").reduce((v, h) => v * h.m, sum(attr));
    c.clear = () => { c.active.forEach((h) => { h.on = false; }); c.active = []; }; // death, load
    c.free = () => { c.clear(); c.freed = true; };
    return c;
}

function addGame(world, ue, options) {
    const alive = (o) => {
        if ((o.owner || o).freed) {
            throw new Error("passing a invalid object");
        }
        return true;
    };
    world.player = "player" in options ? options.player : character("/Game/Map.Hun_1");
    world.enemy = character("/Game/Map.Enemy_1");
    world.loaded = [];
    world.ctxSeen = [];
    ue.KismetSystemLibrary.IsValid = (o) => !!o && alive(o);
    ue.KismetSystemLibrary.GetPathName = (o) => alive(o) && o.path;
    ue.GameplayStatics = { GetPlayerCharacter: (ctx, index) => {
        world.ctxSeen.push([ctx, index]);
        if (world.throws) {
            throw new Error("boom");
        }
        return world.player;
    } };
    ue.BasicAttributeSet = { StaticClass: () => "BasicAttributeSet" };
    ue.PBZBlueprintFunctionLibrary = {
        MakeAttribute: (name, set) => ({ name, set }),
        GetAttributeFromCharacter: (c, attr) => (alive(c) && attr.set == "BasicAttributeSet" ? c.value(attr.name) : NaN),
    };
    ue.Object = { Load(p) {
        world.loaded.push(p);
        const m = /^\/PBZCombatAsset\/Config\/AttributesModifyEffect\/(GE_MA_(\w+)_0_(Mul|Add))\.\1$/.exec(p);
        return m && !options.noEffects ? { attr: m[2], op: m[3] } : undefined;
    } };
    ue.AbilitySystemBlueprintLibrary = {
        GetAbilitySystemComponent: (c) => (alive(c) && !c.noAsc ? c.asc : undefined),
        GetActiveGameplayEffectStackCount: (handle) => (handle.on ? 1 : 0),
        GetFloatAttributeBase: (c, attr, ok) => { ok[0] = true; return c.base[attr.name]; },
        MakeSpecHandle: (effect, instigator, causer, level) => ({ attr: effect.attr, op: effect.op, instigator, causer, level, m: 0, seconds: 0 }),
        AssignSetByCallerMagnitude: (spec, name, m) => ({ ...spec, m: name == "AttributeOpMagnitude" ? m : 0 }),
        SetDuration: (spec, seconds) => ({ ...spec, seconds }),
    };
    ue.EGameplayModOp = { Override: 3 };
    ue.AttributeUtils = { ModifyCharacterAttributeValue(c, attr, op, value) {
        if (op === 3) {
            c.base[attr.name] = value;
        }
    } };
}

// One fresh load of the script with its own stand-in game.
function boot(options = {}) {
    const world = { now: 1000000, files: new Map(), saved: [], warnings: [], logs: [], pushed: [], timer: undefined,
        interval: undefined, cleared: false, loadError: undefined };
    if (options.settings !== undefined) {
        world.files.set(options.settingsPath || SETTINGS_PATH, options.settings);
    }
    const gameInstance = { path: "/Engine/Transient.GameInstance" };
    const ue = {
        KismetSystemLibrary: { IsValid: (o) => !!o, ConvertToAbsolutePath: (p) => p, GetPathName: (o) => o.path },
        BlueprintPathsLibrary: { FileExists: (p) => world.files.has(p) },
        EasyCsv: {
            LoadStringFromLocalFile(p, out) { out[0] = world.files.get(p); return true; },
            SaveStringToFileWithFullPath(text, p) { world.saved.push([p, text]); world.files.set(p, text); },
        },
    };
    addGame(world, ue, options);
    const puerts = {
        $ref: (value) => [value],
        $unref: (box) => box[0],
        argv: { getByName: (name) => (name == "GameInstance" && !options.noGameInstance ? gameInstance : undefined) },
    };
    const stubs = { "ue": ue, "puerts": puerts, "Library/TsHelper": { default: {} } };
    // the game's modules, also for a require() that the mod runs later inside a timer
    const load = Module._load;
    const hooked = function (request, parent, isMain) {
        if (Object.prototype.hasOwnProperty.call(stubs, request)) {
            return stubs[request];
        }
        return load.call(this, request, parent, isMain);
    };
    const realNow = Date.now, realWarn = console.warn, realLog = console.log;
    const enter = () => {
        Module._load = hooked;
        Date.now = () => world.now;
        console.warn = (message) => world.warnings.push(String(message));
        console.log = (message) => world.logs.push(String(message));
    };
    const leave = () => {
        Module._load = load;
        Date.now = realNow;
        console.warn = realWarn;
        console.log = realLog;
    };
    globalThis.setInterval = (fn, ms) => { world.timer = fn; world.interval = ms; return 9; };
    globalThis.clearInterval = (id) => { world.cleared = id === 9; };
    globalThis.PBZModsMenu = options.menu === "array" ? [] : options.menu ? modsMenu(world, options.menuMissing) : undefined;
    world.menuGlobal = globalThis.PBZModsMenu;
    delete require.cache[require.resolve(SCRIPT)];
    enter();
    try {
        world.exports = require(SCRIPT);
    }
    catch (e) {
        world.loadError = e;
    }
    finally {
        leave();
    }
    world.poll = (ms = world.interval) => {
        world.now += ms;
        enter();
        try {
            world.timer();
        }
        finally {
            leave();
        }
    };
    world.stop = () => {
        enter();
        try {
            world.exports.stop();
        }
        finally {
            leave();
        }
    };
    return world;
}

// The module as PBZModLoader loads it.
{
    const w = boot();
    check("no error at load; stop() exported; one poll timer", !w.loadError && typeof w.exports.stop == "function"
        && typeof w.timer == "function");
    check("one start line for loader.log, naming the settings file in the mod's folder",
        w.logs.length == 1 && w.logs[0].startsWith("[PBZMOD] [") && w.logs[0].endsWith(`started; settings: ${SETTINGS_PATH}`));
    check("no Mods Menu: no page pushed anywhere", globalThis.PBZModsMenu === undefined && w.pushed.length == 0);
}

// The settings file.
{
    const w = boot();
    const shipped = fs.readFileSync(SETTINGS, "utf8");
    check("a missing settings file is written once at the start, in the mod's folder, with the shipped text (CRLF)",
        w.saved.length == 1 && w.saved[0][0] == SETTINGS_PATH && w.saved[0][1] == shipped && shipped.includes("\r\n"));
    const kept = boot({ settings: "Enable=Off\r\n" });
    check("an existing settings file is never written over", kept.saved.length == 0);
}

// Mods Menu: optional.
{
    const m = boot({ menu: true });
    const page = m.pushed[0];
    check("Mods Menu running: one page with the mod's id and store \"saved\"", m.pushed.length == 1
        && page.id == "phantombladezero_simplepower" && page.store == "saved" && typeof page.onChange == "function");
    check("... and the mod reads the file the page saves", m.saved.length == 1 && m.saved[0][0] == MENU_PATH
        && m.logs[0].endsWith(`settings: ${MENU_PATH} (Mods Menu's page)`));
    const a = boot({ menu: "array" });
    check("Mods Menu not started yet (a plain array): nothing pushed, the mod's own file",
        a.menuGlobal.length == 0 && a.saved[0][0] == SETTINGS_PATH);
    const o = boot({ menu: true, menuMissing: ["store.saved"] });
    check("an older Mods Menu without store \"saved\": no page, the mod's own file",
        o.pushed.length == 0 && o.saved[0][0] == SETTINGS_PATH);
}

// The effects on the player.
const near = (a, b) => Math.abs(a - b) < 1e-9;
const powers = (w) => [w.player.value("Attack"), w.player.value("ShachiAttack")];
const parry = (w) => w.player.value("Amplification_ReflectShachi");
// The checks below are about Attack and ShachiAttack (parry at 1, no effect) unless they name parry.
const is = (w, attack, shachi, amplification = undefined) => near(powers(w)[0], attack) && near(powers(w)[1], shachi)
    && (amplification === undefined || near(parry(w), amplification));
const text = (attack, shachi, enable = "On", parryValue = 1) =>
    `Enable=${enable}\r\nAttack=${attack}\r\nShaChiAttack=${shachi}\r\nParryShaChi=${parryValue}\r\n`;
function setText(w, value, p = SETTINGS_PATH) {
    w.files.set(p, value);
    w.poll(2000); // the next read of the file
}
{
    const w = boot();
    w.poll();
    check("defaults: Attack and ShachiAttack x1.5, the parry amplification +0.5 on the player", is(w, 150, 120, 0.5));
    check("three timed effects of 1,000,000 s; nothing else of the player changed", w.player.active.length == 3
        && w.player.active.every((h) => h.seconds === 1000000) && w.player.value("Health") == 850);
    check("base values stay the game's own", w.player.base.Attack == 100 && w.player.base.ShachiAttack == 80
        && w.player.base.Amplification_ReflectShachi === 0);
    check("enemies get no effect", w.enemy.active.length == 0);
    check("the player of the GameInstance, index 0", w.ctxSeen.every(([c, i]) => c.path.includes("GameInstance") && i === 0));
    check("one log line per effect with the value before and after", w.logs.length == 4
        && w.logs[1] == "[PBZMOD] [Simple Power] Attack x1.5: Attack 100 -> 150"
        && w.logs[2] == "[PBZMOD] [Simple Power] ShaChiAttack x1.5: ShachiAttack 80 -> 120"
        && w.logs[3] == "[PBZMOD] [Simple Power] ParryShaChi x1.5: Amplification_ReflectShachi 0 -> 0.5");
    for (let i = 0; i < 50; i++) {
        w.poll();
    }
    check("50 more polls: no second effect, no new line", is(w, 150, 120, 0.5) && w.player.active.length == 3 && w.logs.length == 4);
    check("each effect asset loaded once", w.loaded.length == 3);
}

// The multipliers.
{
    const w = boot({ settings: text(2, 3) });
    w.poll();
    check("Attack=2, ShaChiAttack=3: each with its own multiplier", is(w, 200, 240));
    const shachi = w.player.active.find((h) => h.attr == "ShachiAttack");
    setText(w, text(4, 3));
    check("a changed file is used live, and the old effect is replaced (never two)", is(w, 400, 240) && w.player.active.length == 2);
    check("... and the other effect is not touched", w.player.active.includes(shachi));
    setText(w, text(1, 3));
    check("1 takes that effect off", is(w, 100, 240) && w.player.active.length == 1
        && w.logs[w.logs.length - 1].endsWith("Attack: the game's own, Attack 100"));
    const lines = w.logs.length;
    w.poll();
    check("1 stays quiet afterwards", w.logs.length == lines && w.player.active.length == 1);
    setText(w, text(0.5, 0.5));
    check("below 1 weakens", is(w, 50, 40));
    setText(w, text(0, 99));
    check("clamped to 0.1 and 10", is(w, 10, 800));
    setText(w, text("-5", "1,5"));
    check("a negative value is clamped, a decimal comma works", is(w, 10, 120));
    setText(w, text("x2 ; double", ".5 # half"));
    check("x2, .5 and comments work", is(w, 200, 40));
    setText(w, text("abc", "2 3"));
    check("not a number: the last values stay", is(w, 200, 40));
    setText(w, "Enable=On\r\nAttack=\r\n");
    check("an empty or missing key means 1.5 (also a file of 1.0 without ParryShaChi)", is(w, 150, 120, 0.5));
    setText(w, "﻿attack = 3\nSHACHIATTACK=2\nAttack=9\n");
    check("a byte order mark, other case, LF, the first line of a key wins", is(w, 300, 160));
    const s = boot({ settings: text(1, 1) });
    s.poll();
    check("all 1: no effect, no asset loaded, no line", s.player.active.length == 0 && s.loaded.length == 0 && s.logs.length == 1);
}

// Blocks and parries.
{
    const w = boot({ settings: text(1, 1, "On", 3) });
    w.poll();
    check("ParryShaChi=3: the amplification +2, nothing else", is(w, 100, 80, 2) && w.player.active.length == 1);
    w.player.base.Amplification_ReflectShachi = 0.1; // the game's accessory
    check("... on top of the game's own amplification", near(parry(w), 2.1));
    w.player.base.Amplification_ReflectShachi = 0;
    setText(w, text(1, 1, "On", 10));
    check("ParryShaChi=10: +9, the old effect replaced", near(parry(w), 9) && w.player.active.length == 1);
    setText(w, text(1, 1, "On", 0.1));
    check("ParryShaChi=0.1: -0.9", near(parry(w), -0.9) && w.player.active.length == 1);
    setText(w, text(1, 1, "On", 1));
    check("ParryShaChi=1: no effect", parry(w) === 0 && w.player.active.length == 0);
    setText(w, text(2, 2, "Off", 4));
    setText(w, text(2, 2, "On", 4));
    check("ParryShaChi follows Enable", is(w, 200, 160, 3));
    setText(w, text(2, 2, "Off", 4));
    check("... off too", is(w, 100, 80, 0));
    const n = boot({ settings: text(1, 1, "On", 2) });
    n.player.base.Attack = 0;
    n.poll();
    check("a character that is not set up yet (Attack 0): no amplification yet", n.player.active.length == 0);
    n.player.base.Attack = 100;
    n.poll();
    check("... and it comes at a later poll", near(parry(n), 1));
    n.stop();
    check("stop() takes it off", parry(n) === 0);
}

// Enable.
{
    const w = boot({ settings: text(2, 2) });
    w.poll();
    setText(w, text(2, 2, "Off"));
    check("Enable=Off takes both effects off, all stacks", is(w, 100, 80) && w.player.active.length == 0
        && w.player.removed.every(([, stacks]) => stacks === -1));
    setText(w, text(2, 2));
    check("Enable=On puts them back", is(w, 200, 160));
    const off = boot({ settings: text(2, 2, "Off") });
    off.poll();
    check("Enable=Off from the start: nothing", off.player.active.length == 0 && off.ctxSeen.length == 0);
}

// The player dies, loads, is not there yet.
{
    const w = boot({ player: undefined });
    for (let n = 0; n < 20; n++) {
        w.poll();
    }
    check("no player (the main menu): quiet", w.warnings.length == 0 && w.timer !== undefined && !w.cleared);
    w.player = character("/Game/Map.Hun_1");
    w.player.noAsc = true;
    for (let n = 0; n < 20; n++) {
        w.poll();
    }
    check("a player without its ability system: no effect yet, quiet", w.player.active.length == 0 && !w.cleared);
    w.player.noAsc = false;
    w.player.base.Attack = 0;
    w.poll();
    check("an attribute not set up yet is left alone, the other one is not", w.player.active.length == 1
        && w.player.active[0].attr == "ShachiAttack");
    w.player.base.Attack = 100;
    w.poll();
    check("... and gets its effect at a later poll", is(w, 150, 120, 0.5) && w.player.active.length == 3);
    w.player.clear();
    w.poll();
    check("effects the game cleared (death) come back once", is(w, 150, 120, 0.5) && w.player.active.length == 3);
    const old = w.player;
    old.free();
    for (let n = 0; n < 20; n++) {
        w.poll();
    }
    check("a freed player object: quiet", w.warnings.length == 0 && !w.cleared);
    w.player = character("/Game/Map.Hun_1");
    w.poll();
    check("a new player with the same path name gets its effects", is(w, 150, 120, 0.5) && w.player.active.length == 3);
    w.player.clear();
    w.player = character("/Game/Map.Hun_1");
    w.poll();
    check("... also while the old object is still there", is(w, 150, 120, 0.5) && w.player.active.length == 3);
    check("the effect assets are not loaded again", w.loaded.length == 3);
    const first = w.player;
    w.player = character("/Game/Map.Other_2");
    w.poll();
    w.player = first;
    w.poll();
    check("back to a first character: still one effect each", is(w, 150, 120, 0.5) && first.active.length == 3);
    w.stop();
    check("stop() takes the effects off every character", first.active.length == 0);
}

// The game refuses, a base value moves, errors.
{
    const w = boot();
    w.player.refuse = true;
    w.poll();
    check("a refused effect: no line, no warning", w.logs.length == 1 && w.warnings.length == 0);
    w.player.refuse = false;
    w.poll();
    check("... and it is tried again", is(w, 150, 120));
    w.player.base.Attack = 130; // a level up
    w.poll();
    check("a new base value keeps the one effect", near(w.player.value("Attack"), 195) && w.player.active.length == 3);

    const i = boot();
    i.player.instant = true;
    i.poll();
    check("an effect that lands on the base value: the base put back, the mod stops at once", i.player.base.Attack == 100
        && i.cleared && i.warnings.length == 1 && i.warnings[0].includes("base value"));
    check("... before the other attribute is touched", i.player.base.ShachiAttack == 80);

    const t = boot();
    t.poll();
    t.throws = true;
    for (let n = 0; n < 9; n++) {
        t.poll();
    }
    check("9 polls that throw: still running, quiet", !t.cleared && t.warnings.length == 0);
    t.throws = false;
    t.poll();
    t.throws = true;
    for (let n = 0; n < 9; n++) {
        t.poll();
    }
    check("a good poll starts the count again", !t.cleared);
    t.poll();
    check("10 in a row: stopped with one warning, the effects off", t.cleared && t.warnings.length == 1
        && t.warnings[0].includes("stopped") && t.player.active.length == 0);

    const g = boot({ noEffects: true });
    for (let n = 0; n < 10; n++) {
        g.poll();
    }
    check("the effect assets are gone (a game update): stopped, nothing changed", g.cleared && is(g, 100, 80)
        && g.warnings[0].includes("GE_MA_Attack_0_Mul is missing"));

    const k = boot({ settings: text(1.5, 1.5) });
    k.poll();
    k.player.stuck = true;
    setText(k, text(3, 3));
    check("an effect that cannot be taken off: never a second one on top", k.player.active.length == 2 && is(k, 150, 120));
    k.player.stuck = false;
    k.poll();
    check("... and it is replaced at a later poll", is(k, 300, 240) && k.player.active.length == 2);
    k.player.keeps = true;
    setText(k, text(2, 2));
    check("an effect the game keeps: never a second one on top", k.player.active.length == 2 && is(k, 300, 240));
    k.player.keeps = false;
    k.player.stuck = true;
    k.stop();
    check("stop() with an error: a warning, no throw", k.warnings.length == 1 && k.warnings[0].includes("stop:"));
    const e = boot({ settings: text(2, 2) });
    e.poll();
    e.player.stuck = true;
    setText(e, text(2, 2, "Off"));
    e.player.stuck = false;
    e.poll();
    check("Enable=Off is tried again after an error", e.player.active.length == 0);

    const l = boot();
    for (let n = 0; n < 60; n++) {
        l.poll();
        l.player.clear();
    }
    check("at most 30 lines about effects", l.logs.length == 31);
}

// The reload (Alt+F5) and the Mods Menu page.
{
    const w = boot({ settings: text(2, 2) });
    w.poll();
    w.stop();
    check("stop() takes both effects off", is(w, 100, 80));
    const next = boot({ settings: text(2, 2), player: w.player });
    next.poll();
    check("the next copy gives x2, not x4", is(next, 200, 160));

    const m = boot({ menu: true, settings: text(2, 2), settingsPath: MENU_PATH });
    m.poll();
    check("with Mods Menu: the page's file counts", is(m, 200, 160));
    m.files.set(MENU_PATH, text(5, 5));
    m.pushed[0].onChange();
    m.poll(100);
    check("a change on the page is used at the next poll", is(m, 500, 400));
    const shipped = fs.readFileSync(SETTINGS, "utf8");
    check("the page's rows are the file's keys with the same defaults", m.pushed[0].settings.every((row) =>
        shipped.includes(`\r\n${row.key}=${row.default === true ? "On" : row.default}\r\n`))
        && m.pushed[0].settings.length == shipped.split("\r\n").filter((line) => /^\w+=/.test(line)).length);
    check("the page's number rows have the range 0.1 to 10", m.pushed[0].settings.filter((row) => row.type == "number")
        .every((row) => row.min === 0.1 && row.max === 10));
}

// stop() and a failed start.
{
    const w = boot();
    w.poll();
    w.stop();
    check("stop(): the poll timer cleared, a line for loader.log, no warning", w.cleared && w.warnings.length == 0
        && w.logs[w.logs.length - 1].endsWith("] stopped"));
    const again = boot();
    check("a second start after stop() (the reload) loads", !again.loadError);
    const n = boot({ noGameInstance: true });
    check("no GameInstance: the load throws (PBZModLoader logs the mod as failed), one line, no timer",
        !!n.loadError && n.timer === undefined && n.warnings.length == 1 && n.warnings[0].includes("not started"));
}

process.exit(failed ? 1 : 0);
