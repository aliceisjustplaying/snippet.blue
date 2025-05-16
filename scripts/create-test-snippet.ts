// scripts/create-test-snippet.ts
import { BskyAgent } from "@atproto/api";
import { randomBytes } from "node:crypto";
import "dotenv/config";

const agent = new BskyAgent({ service: "https://bsky.social" });

async function main() {
  if (!process.env.TEST_BSKY_HANDLE || !process.env.TEST_BSKY_APP_PWD) {
    console.error("Error: TEST_BSKY_HANDLE and TEST_BSKY_APP_PWD must be set in your .env file.");
    console.error("Please create a .env file based on .env.example and add your credentials.");
    process.exit(1);
  }

  try {
    await agent.login({
      identifier: process.env.TEST_BSKY_HANDLE!,
      password: process.env.TEST_BSKY_APP_PWD!,
    });
    console.log("Logged in to Bluesky successfully.");

    const record = {
      name: "Hello World - Test Snippet",
      lang: "ts",
      code: `console.log('Test snippet from script: ${randomBytes(4).toString("hex")}');`,
      createdAt: new Date().toISOString(),
    };

    await agent.api.com.atproto.repo.createRecord({
      repo: agent.session!.did,
      collection: "blue.snippet.code", // Make sure this matches your lexicon ID
      record: record,
    });
    console.log("Snippet posted successfully!");
    console.log("Record details:", record);

  } catch (error) {
    console.error("Error posting snippet:", error);
    process.exit(1);
  }
}

main();
