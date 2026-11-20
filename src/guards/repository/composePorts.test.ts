import { describe, expect, it } from "vitest";

import { composePorts, openPorts } from "./composePorts.ts";
import { findingsOf, shown } from "./testRepository.ts";

describe("compose-ports", () => {
    it.each([
        ['services:\n  db:\n    ports:\n      - "127.0.0.1:6320:5432"\n', []],
        ["services:\n  db:\n    ports:\n      - 8080:80\n", ["8080:80"]],
        ["services:\n  db:\n    ports:\n      - 5432\n", ["5432"]],
        ["services:\n  web:\n    ports:\n      - target: 80\n        published: 8080\n", ["8080:80"]],
        ["services:\n  web:\n    ports:\n      - target: 80\n        published: 8080\n        host_ip: 127.0.0.1\n", []],
        ["services:\n  web:\n    image: nginx:1.27\n", []],
        ["name: only-a-name\n", []],
    ])("finds the ports open on every interface: %#", (compose, expected) => {
        expect(openPorts(compose).map((open) => open.port)).toEqual(expected);
    });

    it("reads every compose file, with the line of each open port", async () => {
        const files = {
            "compose.yaml": "services:\n  db:\n    ports:\n      - '127.0.0.1:5432:5432'\n      - 9000:9000\n",
            "deploy/compose.prod.yml": "services:\n  web:\n    ports:\n      - 80:80\n",
            "other.yaml": "services:\n  web:\n    ports:\n      - 80:80\n",
        };

        expect(shown(await findingsOf(composePorts, files))).toEqual(["compose.yaml:5", "deploy/compose.prod.yml:4"]);
    });

    it("says how to publish it on the loopback", async () => {
        const [finding] = await findingsOf(composePorts, { "compose.yaml": "services:\n  db:\n    ports: ['8080:80']\n" });
        expect(finding?.message).toContain('write "127.0.0.1:<host port>:<container port>"');
    });
});
