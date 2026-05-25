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

test("runtime setup recovers from a broken compat symlink by re-creating it", () => {
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

    // Pre-create a broken compat symlink pointing at a non-existent dir to
    // simulate a partially-mirrored previous install.
    const compatRoot = path.join(
      homeDir,
      ".pi",
      "agent",
      "npm",
      "node_modules",
      "@n3m6",
      "pi-deepwork",
    );
    fs.mkdirSync(path.dirname(compatRoot), { recursive: true });
    fs.symlinkSync(path.join(homeDir, "does-not-exist"), compatRoot, "dir");

    const result = ensureRuntimeSkillCompatInstall(
      path.join(packageRoot, "dist"),
      homeDir,
    );

    assert.equal(result.applied, true);
    assert.ok(result.skillPath, "skillPath must be reported");
    assert.equal(
      fs.readFileSync(result.skillPath!, "utf-8"),
      "# Deepwork\n",
      "compat SKILL.md must be readable after recovery",
    );
  });
});

test("runtime setup reports an error when copy mirror cannot produce a readable SKILL.md", () => {
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

    // Layout missing skills/deepwork/SKILL.md entirely — symlink + copy will
    // both produce an unreadable target.
    fs.mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      '{"name":"pi-deepwork"}\n',
      "utf-8",
    );
    fs.mkdirSync(path.join(packageRoot, "skills", "deepwork"), {
      recursive: true,
    });

    const result = ensureRuntimeSkillCompatInstall(
      path.join(packageRoot, "dist"),
      homeDir,
    );

    assert.equal(
      result.applied,
      false,
      "applied must be false when SKILL.md cannot be produced",
    );
    assert.ok(
      typeof result.error === "string" && result.error.length > 0,
      "an error must be reported when SKILL.md cannot be produced",
    );
  });
});
