import { defineConfig } from "vitepress";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const isProjectPages = process.env.GITHUB_ACTIONS === "true" && repositoryName;

export default defineConfig({
  srcDir: "docs",
  publicDir: "public",
  outDir: ".vitepress/dist",
  cacheDir: ".vitepress/cache",
  base: isProjectPages ? `/${repositoryName}/` : "/",
  title: "Conan Exiles Enhanced — Player Wiki",
  description: "Player guide for a 5x rates, full-PvP Conan Exiles Enhanced server.",
  cleanUrls: true,
  lastUpdated: true,
  appearance: "dark",
  head: [
    ["meta", { name: "theme-color", content: "#17120f" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "Conan Exiles Enhanced — Player Wiki" }],
    [
      "meta",
      {
        property: "og:description",
        content: "A player-focused guide to the server's verified systems, mods, and controls.",
      },
    ],
    ["meta", { name: "twitter:card", content: "summary" }],
    ["meta", { name: "twitter:title", content: "Conan Exiles Enhanced — Player Wiki" }],
    [
      "meta",
      {
        name: "twitter:description",
        content: "A player-focused guide to the server's verified systems, mods, and controls.",
      },
    ],
  ],
  themeConfig: {
    siteTitle: "Player Wiki",
    search: {
      provider: "local",
      options: {
        detailedView: true,
        miniSearch: {
          searchOptions: {
            fuzzy: 0.2,
            prefix: true,
          },
        },
      },
    },
    nav: [
      { text: "Start Here", link: "/getting-started/" },
      { text: "Systems", link: "/progression/" },
      { text: "Reference", link: "/reference/" },
    ],
    sidebar: [
      {
        text: "Getting Started",
        collapsed: false,
        items: [
          { text: "Start Here", link: "/getting-started/" },
          { text: "Server Overview", link: "/getting-started/server-overview" },
          { text: "Required Mods", link: "/getting-started/required-mods" },
        ],
      },
      {
        text: "Server Rules",
        items: [{ text: "Rules Status", link: "/server-rules/" }],
      },
      {
        text: "Progression",
        items: [
          { text: "Progression Overview", link: "/progression/" },
          { text: "Wings Of Valhalla", link: "/progression/wings-of-valhalla" },
          { text: "EAA — Perks & Level", link: "/progression/eaa-perks-level" },
          { text: "Armory and Arsenal", link: "/progression/armory-and-arsenal" },
        ],
      },
      {
        text: "Combat & Equipment",
        items: [
          { text: "Combat Overview", link: "/combat/" },
          { text: "Highmane's Arsenal", link: "/combat/highmanes-arsenal" },
          { text: "ExilesExtreme", link: "/combat/exiles-extreme" },
        ],
      },
      {
        text: "Magic",
        items: [
          { text: "Magic Overview", link: "/magic/" },
          { text: "Domain's Magic", link: "/magic/domain-magic" },
        ],
      },
      {
        text: "Followers",
        items: [
          { text: "Followers Overview", link: "/followers/" },
          { text: "Better Thralls", link: "/followers/better-thralls" },
          { text: "Extended Thrall Stats", link: "/followers/extended-thrall-stats" },
          { text: "Follower Collision", link: "/followers/follower-collision" },
        ],
      },
      {
        text: "Crafting & Resources",
        items: [{ text: "Crafting Overview", link: "/crafting/" }],
      },
      {
        text: "Building",
        items: [
          { text: "Building Overview", link: "/building/" },
          { text: "Unlock Plus", link: "/building/unlock-plus" },
          { text: "Building Placement", link: "/building/lbpr" },
        ],
      },
      {
        text: "Travel & Exploration",
        items: [
          { text: "Travel Overview", link: "/travel/" },
          { text: "Mystical Travel Shelf", link: "/travel/mystical-travel-shelf" },
        ],
      },
      {
        text: "Quests & World Content",
        items: [{ text: "World Content Status", link: "/quests/" }],
      },
      {
        text: "Economy",
        items: [{ text: "Economy Status", link: "/economy/" }],
      },
      {
        text: "Quality of Life",
        items: [
          { text: "Quality of Life Overview", link: "/qol/" },
          { text: "Simple Minimap", link: "/qol/simple-minimap" },
          { text: "The Damage Meter", link: "/qol/damage-meter" },
          { text: "Proximity Party", link: "/qol/proximity-party" },
          { text: "Fashionist", link: "/qol/fashionist" },
          { text: "Stacksize Plus", link: "/qol/stacksize-plus" },
          { text: "Simple Modlist", link: "/qol/simple-modlist" },
        ],
      },
      {
        text: "Creatures & Bosses",
        items: [{ text: "Creature Guide Status", link: "/creatures/" }],
      },
      {
        text: "Reference",
        items: [
          { text: "Reference Home", link: "/reference/" },
          { text: "Mod Directory", link: "/reference/mod-directory" },
          { text: "Verification", link: "/reference/verification" },
        ],
      },
    ],
    outline: { level: [2, 3], label: "On this page" },
    editLink: {
      pattern: "https://github.com/lastnahaj/hyborian-relay/edit/main/docs/:path",
      text: "Suggest a correction",
    },
    footer: {
      message:
        "Player-facing information only. Unverified server behavior is not published as fact.",
    },
    docFooter: {
      prev: "Previous page",
      next: "Next page",
    },
  },
});
