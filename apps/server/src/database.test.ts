import { afterEach, describe, expect, it } from "vitest";
import { GameDatabase } from "./database.js";

describe("GameDatabase.resumeWechatSession", () => {
  const databases: GameDatabase[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) {
      database.connection.close();
    }
  });

  function createDatabase(): GameDatabase {
    const database = new GameDatabase(":memory:");
    databases.push(database);
    return database;
  }

  it("does not create a placeholder identity for an unknown openid", () => {
    const database = createDatabase();

    expect(database.resumeWechatSession("missing-openid", "new-token-hash")).toBeNull();
    expect(database.findSessionByOpenId("missing-openid")).toBeNull();
    expect(database.findSessionByTokenHash("new-token-hash")).toBeNull();
  });

  it("rotates the token without replacing the saved nickname or avatar", () => {
    const database = createDatabase();
    database.upsertWechatSession(
      {
        openId: "known-openid",
        nickname: "阿岚",
        avatarUrl: "/avatars/alan.png",
      },
      "old-token-hash",
    );

    const resumed = database.resumeWechatSession("known-openid", "new-token-hash");

    expect(resumed).toMatchObject({
      nickname: "阿岚",
      avatarUrl: "/avatars/alan.png",
      wechatOpenId: "known-openid",
    });
    expect(database.findSessionByTokenHash("old-token-hash")).toBeNull();
    expect(database.findSessionByTokenHash("new-token-hash")).toMatchObject({
      nickname: "阿岚",
      avatarUrl: "/avatars/alan.png",
    });
  });
});
