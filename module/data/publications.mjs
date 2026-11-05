/** Bibliographic identities, not per-item corrections or a whitelist of dirty
 * source strings. Runtime declarations can extend this small offline baseline.
 * `rules` is a rules generation, `year` is the publication year (notably MM).
 * Shared family names deliberately do NOT identify an edition.
 */
const core = (family, title, aliases, editions) => editions.map(([id, label, year, rules, extra, codes]) => ({
  id, family, familyLabel: family.toUpperCase(), label, title: `${title} (${year})`, year, rules,
  strictRules: true, aliases: extra, familyAliases: [family, title, ...aliases], externalCodes: codes
}));
const book = (id, label, title, aliases = [], extra = {}) => ({ id, label, title, aliases, ...extra });

export const PUBLICATIONS = Object.freeze([
  ...core("phb", "Player's Handbook", ["Players Handbook", "玩家手册"], [
    ["phb14", "PHB'14", 2014, "2014", ["PHB 2014", "PHB14"], ["PHB"]],
    ["phb24", "PHB'24", 2024, "2024", ["PHB 2024", "PHB24", "XPHB"], ["XPHB"]]
  ]),
  ...core("dmg", "Dungeon Master's Guide", ["Dungeon Masters Guide", "城主指南", "地下城主指南"], [
    ["dmg14", "DMG'14", 2014, "2014", ["DMG 2014", "DMG14"], ["DMG"]],
    ["dmg24", "DMG'24", 2024, "2024", ["DMG 2024", "DMG24", "XDMG"], ["XDMG"]]
  ]),
  ...core("mm", "Monster Manual", ["怪物图鉴"], [
    ["mm14", "MM'14", 2014, "2014", ["MM 2014", "MM14"], ["MM"]],
    // Official Foundry manifests call the 2025 book "MM 2024".
    ["mm25", "MM'25", 2025, "2024", ["MM 2025", "MM25", "MM 2024", "MM24", "Monster Manual 2024", "XMM"], ["XMM"]]
  ]),
  book("srd51", "SRD 5.1", "System Reference Document 5.1", [], { rules: "2014", strictRules: true, category: "reference" }),
  book("srd52", "SRD 5.2", "System Reference Document 5.2", [], { rules: "2024", strictRules: true, category: "reference" }),
  book("basicrules14", "Basic Rules '14", "Basic Rules (2014)", ["Basic Rules"], { rules: "2014", strictRules: true, category: "reference" }),
  book("freerules24", "Free Rules '24", "Free Rules (2024)", ["Free Rules", "D&D Free Rules"], { rules: "2024", strictRules: true, category: "reference" }),
  book("tce", "TCoE", "Tasha's Cauldron of Everything"),
  book("xge", "XGtE", "Xanathar's Guide to Everything"),
  book("ftd", "FTD", "Fizban's Treasury of Dragons"),
  book("ggr", "GGR", "Guildmasters' Guide to Ravnica", ["GTR"]),
  book("egw", "EGW", "Explorer's Guide to Wildemount"),
  book("erlw", "ERLW", "Eberron: Rising from the Last War"),
  book("wge", "WGE", "Wayfinder's Guide to Eberron"),
  book("scag", "SCAG", "Sword Coast Adventurer's Guide"),
  book("bgg", "BGG", "Bigby Presents: Glory of the Giants"),
  book("bmt", "BMT", "The Book of Many Things"),
  book("mpmm", "MPMM", "Mordenkainen Presents: Monsters of the Multiverse", ["MotM", "MMoM"]),
  book("mtf", "MTF", "Mordenkainen's Tome of Foes"),
  book("vgm", "VGM", "Volo's Guide to Monsters"),
  book("vrgr", "VRGR", "Van Richten's Guide to Ravenloft"),
  book("scc", "SCC", "Strixhaven: A Curriculum of Chaos"),
  book("mot", "MOT", "Mythic Odysseys of Theros"),
  book("eepc", "EEPC", "Elemental Evil Player's Companion"),
  book("ai", "AI", "Acquisitions Incorporated"),
  book("sais", "SAiS", "Spelljammer: Adventures in Space"),
  book("aag", "AAG", "Astral Adventurer's Guide"),
  book("paitm", "PAitM", "Planescape: Adventures in the Multiverse"),
  book("sato", "SatO", "Sigil and the Outlands", ["SO"]),
  book("efa", "EFA", "Eberron: Forge of the Artificer"),
  book("frhof", "FRHoF", "Forgotten Realms: Heroes of Faerûn", ["HoF"]),
  book("fraif", "FRAiF", "Forgotten Realms: Adventures in Faerûn", ["AiF"]),
  book("abh", "ABH", "Astarion's Book of Hungers"),
  book("nf", "NF", "Netheril's Fall"),
  book("wthc", "WtHC", "Welcome to the Hellfire Club", ["WttHC"]),
  ...[
    ["cos", "CoS", "Curse of Strahd"], ["toa", "ToA", "Tomb of Annihilation"],
    ["wdh", "WDH", "Waterdeep: Dragon Heist"], ["wdmm", "WDMM", "Waterdeep: Dungeon of the Mad Mage"],
    ["bgdia", "BGDIA", "Baldur's Gate: Descent into Avernus"],
    ["idrotf", "IDRotF", "Icewind Dale: Rime of the Frostmaiden"],
    ["skt", "SKT", "Storm King's Thunder"], ["pota", "PotA", "Princes of the Apocalypse"],
    ["oota", "OotA", "Out of the Abyss"], ["hotdq", "HotDQ", "Hoard of the Dragon Queen"],
    ["rot", "RoT", "The Rise of Tiamat"], ["tod", "ToD", "Tyranny of Dragons"],
    ["lmop", "LMoP", "Lost Mine of Phandelver"], ["gos", "GoS", "Ghosts of Saltmarsh"],
    ["wbtw", "WBtW", "The Wild Beyond the Witchlight"],
    ["llk", "LLK", "Lost Laboratory of Kwalish"], ["tftyp", "TftYP", "Tales from the Yawning Portal"],
    ["dsotdq", "DSotDQ", "Dragonlance: Shadow of the Dragon Queen"],
    ["crcotn", "CRCotN", "Critical Role: Call of the Netherdeep", ["CotN"]],
    ["pabtso", "PaBTSO", "Phandelver and Below: The Shattered Obelisk", ["PBTSO", "Phandelver & Below: The Shattered Obelisk"]],
    ["hftt", "HftT", "Hunt for the Thessalhydra"], ["lr", "LR", "Locathah Rising"],
    ["ttp", "TTP", "The Tortle Package"], ["oga", "OGA", "One Grung Above"]
  ].map(([id, label, title, aliases]) => book(id, label, title, aliases, { category: "adventure" })),
  book("tcsr", "TCSR", "Tal'Dorei Campaign Setting Reborn", [], { category: "third-party" }),
  book("tir", "TIR", "The Illrigger Revised", [], { category: "third-party" }),
  book("tpc24", "TPC'24", "The Pugilist Class (2024)", ["TPC 2024", "TPC24"], { family: "tpc", familyLabel: "TPC", familyAliases: ["TPC", "The Pugilist Class"], rules: "2024", strictRules: true, category: "third-party" }),
  book("tob1", "ToB 1", "Tome of Beasts 1", [], { category: "third-party" }),
  book("uaracesofeberron2018", "UA: Races of Eberron (2018)", "Unearthed Arcana: Races of Eberron (2018)", ["UA 2018 · Races of Eberron"], { category: "playtest" })
].map(record => Object.freeze(record)));
