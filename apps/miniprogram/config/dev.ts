import type { UserConfigExport } from "@tarojs/cli";

const config: UserConfigExport<"webpack5"> = {
  logger: {
    quiet: false,
    stats: true,
  },
  mini: {},
  h5: {},
};

export default config;
