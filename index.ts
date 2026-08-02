/**
 * pi-statusbar-control
 *
 * Lets you easily show/hide EVERY element pi's footer can display: the
 * built-in segments (path/git/session, token stats, cost, context usage,
 * model/thinking) as well as anything an extension injects via
 * ctx.ui.setStatus(key, text).
 *
 * Commands:
 *   /statusbar        - open toggle list for all known elements
 *   /statusbar list   - print known elements and their current visibility
 *   /statusbar on     - re-enable filtered footer (default)
 *   /statusbar off    - restore pi's default footer untouched
 *
 * Visibility choices persist to ~/.pi/agent/settings.json under "statusbarControl".
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep, dirname, join } from "node:path";

interface StatusbarControlSettings {
	enabled: boolean;
	// keys explicitly hidden by the user (built-in segment ids or extension setStatus keys)
	hidden: string[];
	// every extension-status key ever seen, so the toggle list stays stable across sessions
	knownKeys: string[];
}

// Built-in footer segments, matching pi's default FooterComponent output.
// These are NOT extension statuses, so they never showed up as toggles before.
const BUILTIN_SEGMENTS: { id: string; label: string }[] = [
	{ id: "builtin:path", label: "path (cwd / git branch / session name)" },
	{ id: "builtin:tokens", label: "token stats (↑in ↓out cache hit%)" },
	{ id: "builtin:cost", label: "cost ($ / subscription label)" },
	{ id: "builtin:context", label: "context usage (%/window)" },
	{ id: "builtin:model", label: "model (+ thinking level, provider)" },
];

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

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" || (relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));
	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
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
					const hidden = new Set(settings.hidden);
					const lines: string[] = [];

					// --- built-in: path / git branch / session name ---
					if (!hidden.has("builtin:path")) {
						let pwd = formatCwdForFooter(ctx.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);
						const branch = footerData.getGitBranch();
						if (branch) pwd = `${pwd} (${branch})`;
						const sessionName = ctx.sessionManager.getSessionName?.();
						if (sessionName) pwd = `${pwd} • ${sessionName}`;
						lines.push(truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "...")));
					}

					// --- gather usage totals across the whole session ---
					let input = 0;
					let output = 0;
					let cacheRead = 0;
					let cacheWrite = 0;
					let cost = 0;
					let latestCacheHitRate: number | undefined;
					for (const entry of ctx.sessionManager.getEntries()) {
						const usage =
							entry.type === "message" && (entry.message.role === "assistant" || entry.message.role === "toolResult")
								? (entry.message as any).usage
								: entry.type === "branch_summary" || entry.type === "compaction"
									? (entry as any).usage
									: undefined;
						if (!usage) continue;
						input += usage.input || 0;
						output += usage.output || 0;
						cacheRead += usage.cacheRead || 0;
						cacheWrite += usage.cacheWrite || 0;
						cost += usage.cost?.total || 0;
						if (entry.type === "message" && entry.message.role === "assistant") {
							const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
							latestCacheHitRate = promptTokens > 0 ? (usage.cacheRead / promptTokens) * 100 : undefined;
						}
					}

					const statsParts: string[] = [];

					if (!hidden.has("builtin:tokens")) {
						if (input) statsParts.push(`↑${formatTokens(input)}`);
						if (output) statsParts.push(`↓${formatTokens(output)}`);
						if (cacheRead) statsParts.push(`R${formatTokens(cacheRead)}`);
						if (cacheWrite) statsParts.push(`W${formatTokens(cacheWrite)}`);
						if ((cacheRead > 0 || cacheWrite > 0) && latestCacheHitRate !== undefined) {
							statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
						}
					}

					if (!hidden.has("builtin:cost")) {
						const usingSubscription = ctx.model
							? ctx.model.provider === "kimi-coding" || ctx.modelRegistry.isUsingOAuth(ctx.model)
							: false;
						if (cost || usingSubscription) {
							statsParts.push(`$${cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
						}
					}

					if (!hidden.has("builtin:context")) {
						const usage = ctx.getContextUsage();
						const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
						const percentValue = usage?.percent ?? 0;
						const percentStr = usage?.percent !== null && usage?.percent !== undefined ? percentValue.toFixed(1) : "?";
						const display = `${percentStr}${percentStr === "?" ? "" : "%"}/${formatTokens(contextWindow)}`;
						const colored =
							percentValue > 90
								? theme.fg("error", display)
								: percentValue > 70
									? theme.fg("warning", display)
									: display;
						statsParts.push(colored);
					}

					let statsLeft = statsParts.join(" ");
					let statsLeftWidth = visibleWidth(statsLeft);
					if (statsLeftWidth > width) {
						statsLeft = truncateToWidth(statsLeft, width, "...");
						statsLeftWidth = visibleWidth(statsLeft);
					}

					let rightSide = "";
					if (!hidden.has("builtin:model")) {
						const modelName = ctx.model?.id || "no-model";
						rightSide = modelName;
						if (ctx.model?.reasoning) {
							const thinkingLevel = ctx.thinkingLevel || "off";
							rightSide = thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
						}
						if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
							const withProvider = `(${ctx.model.provider}) ${rightSide}`;
							if (statsLeftWidth + 2 + visibleWidth(withProvider) <= width) rightSide = withProvider;
						}
					}

					const minPadding = 2;
					const rightSideWidth = visibleWidth(rightSide);
					const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;
					let statsLine: string;
					if (!rightSide) {
						statsLine = statsLeft;
					} else if (totalNeeded <= width) {
						statsLine = statsLeft + " ".repeat(Math.max(0, width - statsLeftWidth - rightSideWidth)) + rightSide;
					} else {
						const availableForRight = width - statsLeftWidth - minPadding;
						if (availableForRight > 0) {
							const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
							statsLine =
								statsLeft + " ".repeat(Math.max(0, width - statsLeftWidth - visibleWidth(truncatedRight))) + truncatedRight;
						} else {
							statsLine = statsLeft;
						}
					}

					if (statsLine) {
						const dimStatsLeft = theme.fg("dim", statsLeft);
						const remainder = statsLine.slice(statsLeft.length);
						lines.push(dimStatsLeft + theme.fg("dim", remainder));
					}

					// --- extension-injected statuses (ctx.ui.setStatus) ---
					const statuses = footerData.getExtensionStatuses();
					rememberKeys(statuses.keys());
					const visibleExt = Array.from(statuses.entries())
						.filter(([key, text]) => !hidden.has(key) && text)
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([, text]) => sanitizeStatusText(text));
					if (visibleExt.length > 0) {
						lines.push(truncateToWidth(visibleExt.join(" "), width, theme.fg("dim", "...")));
					}

					return lines.length > 0 ? lines : [""];
				},
			};
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		settings = loadSettings();
		applyFooter(ctx);
	});

	pi.registerCommand("statusbar", {
		description: "Show/hide status-bar elements (built-in and extension-injected)",
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

			const allIds = [...BUILTIN_SEGMENTS.map((s) => s.id), ...settings.knownKeys];

			if (sub === "list") {
				const hidden = new Set(settings.hidden);
				const lines = [
					...BUILTIN_SEGMENTS.map((s) => `${hidden.has(s.id) ? "hidden" : "shown "}  ${s.label}`),
					...settings.knownKeys.map((k) => `${hidden.has(k) ? "hidden" : "shown "}  ${k}`),
				];
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			if (ctx.mode !== "tui") {
				ctx.ui.notify("/statusbar requires TUI mode", "error");
				return;
			}

			await ctx.ui.custom((tui, theme, _kb, done) => {
				const hidden = new Set(settings.hidden);
				const items: SettingItem[] = [
					...BUILTIN_SEGMENTS.map((s) => ({
						id: s.id,
						label: s.label,
						currentValue: hidden.has(s.id) ? "hidden" : "shown",
						values: ["shown", "hidden"],
					})),
					...settings.knownKeys.map((key) => ({
						id: key,
						label: key,
						currentValue: hidden.has(key) ? "hidden" : "shown",
						values: ["shown", "hidden"],
					})),
				];

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
					Math.min(items.length + 2, 18),
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
