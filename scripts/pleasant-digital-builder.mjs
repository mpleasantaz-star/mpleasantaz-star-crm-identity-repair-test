import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const encoded = process.env.WORK_ORDER;
if (!encoded || !process.env.OPENAI_API_KEY) throw new Error("WORK_ORDER and OPENAI_API_KEY are required.");
const plan = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
const forbidden = /(^|\/)(\.git|\.env|node_modules|dist|build)(\/|$)|^\.github\/workflows\//;
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "files"],
  properties: {
    summary: { type: "string" },
    files: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content"],
        properties: { path: { type: "string" }, content: { type: "string" } },
      },
    },
  },
};
const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_BUILDER_MODEL || "gpt-5.5", instructions: "Implement only the signed work order as a self-contained, responsive static review site. Return complete file contents under generated-site/. Use generated-site/index.html as the entry point, plus local CSS or JavaScript only when needed. Do not request, read, modify, or summarize existing repository source. Do not edit workflows, secrets, lockfiles, generated output outside generated-site/, deployment configuration, or production credentials. Do not add destructive operations. Keep changes reviewable and accessible.", input: `SIGNED WORK ORDER:\n${JSON.stringify(plan)}`, text: { format: { type: "json_schema", name: "repository_patch", strict: true, schema } } }) });
if (!response.ok) throw new Error(`OpenAI request failed (${response.status}): ${await response.text()}`);
const payload = await response.json();
const output = payload.output?.flatMap(item => item.content ?? []).find(item => item.type === "output_text")?.text;
if (!output) throw new Error("Builder returned no structured changes.");
const result = JSON.parse(output);
for (const file of result.files) {
  const path = file.path.replaceAll("\\", "/");
  if (!path.startsWith("generated-site/") || path.startsWith("/") || path.includes("../") || forbidden.test(path) || /(?:^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(path)) throw new Error(`Unsafe builder path rejected: ${file.path}`);
  if (Buffer.byteLength(file.content, "utf8") > 250_000) throw new Error(`Generated file is too large: ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, file.content, "utf8");
}
writeFileSync("pleasant-digital-build-summary.md", `# Protected build summary\n\n${result.summary}\n`, "utf8");
