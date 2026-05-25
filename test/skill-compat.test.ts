import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  ensureRuntimeSkillCompatInstall,
  getGitInstallCompatLayout,
} from "../src/skill-compat";

function withTempHome(run: (homeDir: string) => void): void {
  const homeDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pi-deepwork-skill-compat-"),
  );

  try {
    run(homeDir);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

test("git install layout maps to scoped npm compatibility path", () => {
  withTempHome((homeDir) => {
    const packageRoot = path.join(
      homeDir,
      ".pi",
      "agent",
      "git",
      "github.com",
      "n3m6",
      "pi-deepwork",
    );

    assert.deepEqual(getGitInstallCompatLayout(packageRoot, homeDir), {
      sourceRoot: packageRoot,
      targetRoot: path.join(
        homeDir,
        ".pi",
        "agent",
        "npm",
        "node_modules",
        "@n3m6",
        "pi-deepwork",
      ),
    });
  });
});

test("runtime setup creates a readable npm-compatible Deepwork skill path", () => {
  withTempHome((homeDir) => {
    const packageRoot = path.join(
      homeDir,
      ".pi",
      "agent",
      "git",
      "github.com",
      "n3m6",
      "pi-deepwork",
    );
    const skillPath = path.join(packageRoot, "skills", "deepwork", "SKILL.md");

    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      '{"name":"pi-deepwork"}\n',
      "utf-8",
    );
    fs.writeFileSync(skillPath, "# Deepwork\n", "utf-8");

    const result = ensureRuntimeSkillCompatInstall(
      path.join(packageRoot, "dist"),
      homeDir,
    );
    assert.equal(result.applied, true);
    assert.ok(result.targetRoot, "targetRoot should be reported");
    assert.ok(result.skillPath, "skillPath should be reported");
    assert.match(result.mode ?? "", /symlink|copied|existing/);

    const compatSkillPath = path.join(
      result.targetRoot!,
      "skills",
      "deepwork",
      "SKILL.md",
    );
    assert.equal(result.skillPath, compatSkillPath);
    assert.equal(fs.readFileSync(compatSkillPath, "utf-8"), "# Deepwork\n");
  });
});

test("runtime setup is a no-op outside pi git install roots", () => {
  withTempHome((homeDir) => {
    const packageRoot = path.join(homeDir, "workspace", "pi-deepwork");
    const skillPath = path.join(packageRoot, "skills", "deepwork", "SKILL.md");

    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      '{"name":"pi-deepwork"}\n',
      "utf-8",
    );
    fs.writeFileSync(skillPath, "# Deepwork\n", "utf-8");

    const result = ensureRuntimeSkillCompatInstall(
      path.join(packageRoot, "dist"),
      homeDir,
    );
    assert.equal(result.applied, false);
    assert.equal(result.error, undefined);
  });
});
