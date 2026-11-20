import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Node } from "yaml";

import type { Finding, Guard } from "../../gate/contract.ts";
import { baseName } from "./text.ts";

const COMPOSE_FILE = /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/;
const LOOPBACK = "127.0.0.1";

function lineOf(node: Node, lineCounter: LineCounter): number | undefined {
    const start = node.range?.[0];
    return start === undefined ? undefined : lineCounter.linePos(start).line;
}

function openPort(entry: unknown): string | null {
    if (isScalar(entry)) {
        const port = String(entry.value);
        return port.startsWith(`${LOOPBACK}:`) ? null : port;
    }
    if (isMap(entry)) {
        const hostIp = entry.get("host_ip");
        const published: unknown = entry.get("published");
        const target: unknown = entry.get("target");
        const shown = (value: unknown, fallback: string) =>
            typeof value === "string" || typeof value === "number" ? String(value) : fallback;
        return hostIp === LOOPBACK ? null : `${shown(published, "a random port")}:${shown(target, "?")}`;
    }
    return null;
}

export function openPorts(text: string): { line?: number; port: string }[] {
    const lineCounter = new LineCounter();
    const document = parseDocument(text, { lineCounter });
    const services = document.get("services", true);
    if (!isMap(services)) return [];
    return services.items.flatMap((service) => {
        const ports = isMap(service.value) ? service.value.get("ports", true) : undefined;
        if (!isSeq(ports)) return [];
        return ports.items.flatMap((entry) => {
            const port = openPort(entry);
            if (port === null) return [];
            const line = isScalar(entry) || isMap(entry) ? lineOf(entry, lineCounter) : undefined;
            return [line === undefined ? { port } : { line, port }];
        });
    });
}

export const composePorts: Guard = {
    id: "compose-ports",
    description: "Every compose file publishes its ports on the loopback (127.0.0.1) only, never on every network interface",
    profiles: "every",
    check(context) {
        return context.files
            .filter((file) => COMPOSE_FILE.test(baseName(file)))
            .flatMap((file) =>
                openPorts(context.read(file)).map(({ line, port }): Finding => {
                    const finding = {
                        target: file,
                        message: `${port} is published on every network interface, which puts it on the network and past the host's firewall: write "127.0.0.1:<host port>:<container port>" (or host_ip: 127.0.0.1)`,
                    };
                    return line === undefined ? finding : { ...finding, line };
                }),
            );
    },
};
