/**
 * Which family demo this process serves — the Korean one (default) or the
 * English one. One switch, DEMO_CONTENT_LANG=ko|en, read here and nowhere
 * else: the runtime (gift ledger, family skills, demo login) and the demo
 * scripts (accounts, push, seed, trip date — `--lang en` sets it) all ask
 * this module for the demo's names, paths and seed.
 *
 * The two demos are parallel data sets, each on its own drives
 * (~/.ainmem-demo vs ~/.ainmem-demo-en), so a server shows one of them.
 */
import * as KO from "./family-demo";
import * as EN from "./family-demo.en";
import { FAMILY_DEMO_ACCOUNTS as KO_ACCOUNTS } from "./scripts";
import { SEED as KO_SEED } from "./family-seed";
import { SEED as EN_SEED, type FamilySeed } from "./family-seed.en";

export type DemoLang = "ko" | "en";
export type { FamilySeed };

export type FamilyKey = keyof typeof EN.FAMILY;

export interface FamilyDemo {
  /** each member as the demo's data names them (`name`) and in English (`en`) */
  FAMILY: Record<FamilyKey, { name: string; en: string }>;
  /** data name → English display name */
  FAMILY_NAME_EN: Record<string, string>;
  /** the family teamspace (and family chat room) */
  FAMILY_WORKSPACE_NAME: string;
  /** the pocket-money ledgers in each person's aindrive */
  LEDGER: { out: string; in: string; head: string; entry: (title: string) => string };
  /** the demo's people: key, workspace name, aindrive drive name */
  FAMILY_DEMO_ACCOUNTS: readonly { key: string; name: string; drive: string }[];
}

const DEMOS: Record<DemoLang, FamilyDemo> = {
  ko: {
    FAMILY: Object.fromEntries(Object.entries(KO.FAMILY).map(([k, f]) => [k, { name: f.ko, en: f.en }])) as FamilyDemo["FAMILY"],
    FAMILY_NAME_EN: KO.FAMILY_NAME_EN,
    FAMILY_WORKSPACE_NAME: KO.FAMILY_WORKSPACE_NAME,
    LEDGER: KO.LEDGER,
    FAMILY_DEMO_ACCOUNTS: KO_ACCOUNTS,
  },
  en: {
    FAMILY: EN.FAMILY,
    FAMILY_NAME_EN: Object.fromEntries(Object.values(EN.FAMILY).map((f) => [f.name, f.en])),
    FAMILY_WORKSPACE_NAME: EN.FAMILY_WORKSPACE_NAME,
    LEDGER: EN.LEDGER,
    FAMILY_DEMO_ACCOUNTS: EN.FAMILY_DEMO_ACCOUNTS,
  },
};

const SEEDS: Record<DemoLang, FamilySeed> = { ko: KO_SEED, en: EN_SEED };

/** DEMO_CONTENT_LANG, `ko` unless it says `en`. */
export function demoLang(): DemoLang {
  const v = (process.env.DEMO_CONTENT_LANG ?? "").trim().toLowerCase();
  if (v && v !== "ko" && v !== "en") throw new Error(`DEMO_CONTENT_LANG is "ko" or "en", not "${v}"`);
  return v === "en" ? "en" : "ko";
}

/** For the demo scripts: `--lang ko|en` on the command line sets
 *  DEMO_CONTENT_LANG for this process. Call it before anything reads the demo. */
export function demoLangFromArgs(argv: readonly string[] = process.argv): DemoLang {
  const i = argv.indexOf("--lang");
  if (i > 0) {
    const v = (argv[i + 1] ?? "").toLowerCase();
    if (v !== "ko" && v !== "en") throw new Error(`--lang is "ko" or "en", not "${argv[i + 1] ?? ""}"`);
    process.env.DEMO_CONTENT_LANG = v;
  }
  return demoLang();
}

/** The demo's home directory name under $HOME (keys, drives, CLI homes, family.json). */
export const demoHomeName = (): string => (demoLang() === "en" ? ".ainmem-demo-en" : ".ainmem-demo");

/** The names, paths and ledger of the demo this process serves. */
export const familyDemo = (): FamilyDemo => DEMOS[demoLang()];

/** What scripts/seed-family-demo.mts writes for the demo this process serves. */
export const familySeed = (): FamilySeed => SEEDS[demoLang()];
