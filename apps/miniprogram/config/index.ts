import path from "node:path";
import type { UserConfigExport } from "@tarojs/cli";

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
    // Overridable at build time: TARO_APP_API_BASE=https://your.domain
    TARO_APP_API_BASE: JSON.stringify(process.env.TARO_APP_API_BASE ?? "http://127.0.0.1:3000"),
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
