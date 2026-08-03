export default {
  pages: [
    "pages/index/index",
    "pages/room/index",
    "pages/checkin/index",
    "pages/backpack/index",
  ],
  lazyCodeLoading: "requiredComponents",
  window: {
    backgroundTextStyle: "light",
    navigationBarBackgroundColor: "#eef6f0",
    navigationBarTitleText: "晃晃",
    navigationBarTextStyle: "black",
    backgroundColor: "#eef6f0",
  },
  // Phone play is landscape-only for this product.
  // pageOrientation is also set per-page; keep app-level default landscape.
};
