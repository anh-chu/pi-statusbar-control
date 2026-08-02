/**
 * pi-statusbar-control
 *
 * Lets you easily show/hide status-bar elements that ANY extension injects
 * via ctx.ui.setStatus(key, text). Extensions register statuses under a key
 * (e.g. "vibe-mode", "stash-indicator"); this extension intercepts the
 * aggregated map (footerData.getExtensionStatuses()) and only renders the
 * keys you've enabled.
 *
 * Commands:
 *   /statusbar        - open toggle list for all known status keys
 *   /statusbar list   - print known keys and their current visibility
 *   /statusbar on     - re-enable filtered footer (default)
 *   /statusbar off    - restore pi's default footer untouched
 *
 * Visibility choices persist to ~/.pi/agent/settings.json under "statusbarControl".
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface StatusbarControlSettings {
	enabled: boolean;
	// keys explicitly hidden by the user
	hidden: string[];
	// every key ever seen, so the toggle list stays stable across sessions
	knownKeys: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getSettingsPath(): string {
	const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();
	return join(homeDir, ".pi", "agent", "settings.json");
}

function loadSettings(): StatusbarControlSettings {
	const defaults: StatusbarControlSettings = { enabled: true, hidden: [], knownKeys: [] };
	const settingsPath = getSettingsPath();
	if (!existsSync(settingsPath)) return defaults;
	try {
		const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
		if (!isRecord(parsed)) return defaults;
		const section = parsed.statusbarControl;
		if (!isRecord(section)) return defaults;
		return {
			enabled: typeof section.enabled === "boolean" ? section.enabled : true,
			hidden: Array.isArray(section.hidden) ? section.hidden.filter((v): v is string => typeof v === "string") : [],
			knownKeys: Array.isArray(section.knownKeys)
				? section.knownKeys.filter((v): v is string => typeof v === "string")
				: [],
		};
	} catch {
		return defaults;
	}
}

function saveSettings(settings: StatusbarControlSettings): boolean {
	const settingsPath = getSettingsPath();
	let existing: Record<string, unknown> = {};
	if (existsSync(settingsPath)) {
		try {
			const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
			if (isRecord(parsed)) existing = parsed;
		} catch {
			return false;
		}
	}
	existing.statusbarControl = settings;
	try {
		mkdirSync(dirname(settingsPath), { recursive: true });
		writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + "\n");
		return true;
	} catch {
		return false;
	}
}

function fmtTokens(n: number): string {
	return n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`;
}

export default function statusbarControl(pi: ExtensionAPI) {
	let settings = loadSettings();

	function rememberKeys(keys: Iterable<string>) {
		let changed = false;
		const known = new Set(settings.knownKeys);
		for (const k of keys) {
			if (!known.has(k)) {
				known.add(k);
				changed = true;
			}
		}
		if (changed) {
			settings = { ...settings, knownKeys: Array.from(known) };
			saveSettings(settings);
		}
	}

	function applyFooter(ctx: ExtensionContext) {
		if (!settings.enabled) {
			ctx.ui.setFooter(undefined);
			return;
		}

		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					const statuses = footerData.getExtensionStatuses();
					rememberKeys(statuses.keys());

					const hidden = new Set(settings.hidden);
					const visibleParts: string[] = [];
					for (const [key, text] of statuses) {
						if (!hidden.has(key) && text) visibleParts.push(text);
					}

					// base info: model, git branch, context/token stats (same shape as default footer)
					let input = 0;
					let output = 0;
					let cost = 0;
					for (const e of ctx.sessionManager.getBranch()) {
						if (e.type === "message" && e.message.role === "assistant") {
							const m = e.message as AssistantMessage;
							input += m.usage.input;
							output += m.usage.output;
							cost += m.usage.cost.total;
						}
					}

					const branch = footerData.getGitBranch();
					const branchStr = branch ? ` (${branch})` : "";
					const left = theme.fg("dim", visibleParts.join("  "));
					const right = theme.fg(
						"dim",
						`${ctx.model?.id || "no-model"}${branchStr} ↑${fmtTokens(input)} ↓${fmtTokens(output)} $${cost.toFixed(3)}`,
					);

					const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
					const line = left + " ".repeat(gap) + right;
					return [truncateToWidth(line, width)];
				},
			};
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		settings = loadSettings();
		applyFooter(ctx);
	});

	pi.registerCommand("statusbar", {
		description: "Show/hide status-bar elements injected by extensions",
		handler: async (args, ctx) => {
			const sub = args.trim().toLowerCase();

			if (sub === "off") {
				settings = { ...settings, enabled: false };
				saveSettings(settings);
				applyFooter(ctx);
				ctx.ui.notify("Statusbar control disabled; default footer restored", "info");
				return;
			}

			if (sub === "on") {
				settings = { ...settings, enabled: true };
				saveSettings(settings);
				applyFooter(ctx);
				ctx.ui.notify("Statusbar control enabled", "info");
				return;
			}

			if (sub === "list") {
				const hidden = new Set(settings.hidden);
				if (settings.knownKeys.length === 0) {
					ctx.ui.notify("No status-bar keys observed yet", "info");
					return;
				}
				const lines = settings.knownKeys.map((k) => `${hidden.has(k) ? "hidden" : "shown "}  ${k}`);
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			if (ctx.mode !== "tui") {
				ctx.ui.notify("/statusbar requires TUI mode", "error");
				return;
			}

			if (settings.knownKeys.length === 0) {
				ctx.ui.notify(
					"No extension-injected status keys observed yet. Trigger the extensions that use ctx.ui.setStatus, then run /statusbar again.",
					"info",
				);
				return;
			}

			await ctx.ui.custom((tui, theme, _kb, done) => {
				const hidden = new Set(settings.hidden);
				const items: SettingItem[] = settings.knownKeys.map((key) => ({
					id: key,
					label: key,
					currentValue: hidden.has(key) ? "hidden" : "shown",
					values: ["shown", "hidden"],
				}));

				const container = new Container();
				container.addChild(
					new (class {
						render(_width: number) {
							return [theme.fg("accent", theme.bold("Statusbar Elements")), ""];
						}
						invalidate() {}
					})(),
				);

				const settingsList = new SettingsList(
					items,
					Math.min(items.length + 2, 15),
					getSettingsListTheme(),
					(id, newValue) => {
						const hiddenSet = new Set(settings.hidden);
						if (newValue === "hidden") hiddenSet.add(id);
						else hiddenSet.delete(id);
						settings = { ...settings, hidden: Array.from(hiddenSet) };
						saveSettings(settings);
						tui.requestRender();
					},
					() => {
						done(undefined);
					},
				);
				container.addChild(settingsList);

				return {
					render: (width: number) => container.render(width),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => {
						settingsList.handleInput?.(data);
						tui.requestRender();
					},
				};
			});
		},
	});
}
