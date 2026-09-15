import { readFileSync } from "node:fs";
import { expect } from "chai";
import { ethers } from "ethers";
import tokenArtifact from "../artifacts/contracts/HVXToken.sol/HVXToken.json" with { type: "json" };
import vaultArtifact from "../artifacts/contracts/HVXVestingVault.sol/HVXVestingVault.json" with { type: "json" };

/** The demo page embeds hand-written ABI fragments (functions and decoded errors). Keep them in sync with the compiled contracts. */
describe("demo/index.html ABI fragments", function () {
  const html = readFileSync("demo/index.html", "utf8");
  const extract = (name: string) => JSON.parse(html.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`))![1]) as string[];

  const check = (fragments: string[], artifact: { abi: any[] }) => {
    const real = new ethers.Interface(artifact.abi);
    for (const frag of fragments) {
      if (frag.startsWith("error ")) {
        const err = ethers.ErrorFragment.from(frag);
        expect(real.getError(err.name), `${err.name} missing from contract`).to.not.equal(null);
        continue;
      }
      const f = ethers.FunctionFragment.from(frag);
      const r = real.getFunction(f.name);
      expect(r, `${f.name} missing from contract`).to.not.equal(null);
      expect(f.format("minimal"), `${f.name} signature drifted`).to.equal(r!.format("minimal"));
    }
  };

  it("TOKEN_ABI matches HVXToken", function () { check(extract("TOKEN_ABI"), tokenArtifact); });
  it("VAULT_ABI matches HVXVestingVault (incl. revokedAt in getSchedule)", function () {
    const frags = extract("VAULT_ABI");
    check(frags, vaultArtifact);
    expect(frags.find((f) => f.startsWith("function getSchedule"))).to.include("uint64 revokedAt");
    expect(frags.some((f) => f.startsWith("function lockedAmount"))).to.equal(true);
  });
});
