import { readFileSync } from "node:fs";
import path from "node:path";
import type { UserConfigExport } from "@tarojs/cli";

const DEFAULT_API_BASE = "https://huanghuang.amazingzz.xyz";

// There is no way to read, at build time, the version string a developer
// types into the WeChat DevTools "上传" dialog when publishing a 体验版 —
// that field only lives in the DevTools UI at upload time. So instead we
// read this package's own package.json "version" field, which the
// developer must manually keep in sync with whatever they're about to type
// into that dialog before each build + upload. This is an intentional
// manual-sync convention, not an oversight.
function resolveAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, "../package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const config: UserConfigExport<"webpack5"> = {
  projectName: "huanghuang",
  date: "2026-7-21",
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    375: 2,
    828: 1.81 / 2,
  },
  sourceRoot: "src",
  outputRoot: "dist",
  plugins: ["@tarojs/plugin-framework-react"],
  defineConstants: {
    // Experience/release builds must be upload-safe by default. Local server
    // work remains opt-in via TARO_APP_API_BASE=http://127.0.0.1:3000.
    TARO_APP_API_BASE: JSON.stringify(process.env.TARO_APP_API_BASE ?? DEFAULT_API_BASE),
    // Lets the "关于" modal show which build is actually running on device.
    TARO_APP_VERSION: JSON.stringify(resolveAppVersion()),
    // Evaluated once when this build kicks off — timestamp shown alongside
    // TARO_APP_VERSION in the "关于" modal.
    TARO_APP_BUILT_AT: JSON.stringify(new Date().toISOString()),
  },
  copy: {
    patterns: [],
    options: {},
  },
  framework: "react",
  compiler: "webpack5",
  cache: {
    enable: false,
  },
  mini: {
    postcss: {
      pxtransform: {
        enable: true,
        config: {},
      },
      cssModules: {
        enable: false,
      },
    },
    webpackChain(chain) {
      chain.resolve.alias.set("@", path.resolve(__dirname, "..", "src"));
    },
  },
  h5: {
    publicPath: "/",
    staticDirectory: "static",
  },
};

export default function (merge: (...configs: object[]) => object) {
  if (process.env.NODE_ENV === "development") {
    return merge({}, config, require("./dev"));
  }
  return merge({}, config, require("./prod"));
}
