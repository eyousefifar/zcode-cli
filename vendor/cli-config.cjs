Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let node_fs = require("node:fs");
let node_fs_promises = require("node:fs/promises");
let node_path = require("node:path");
let node_crypto = require("node:crypto");
let node_os = require("node:os");
//#region src/config-paths.ts
function cliSettingsPath(env = process.env, platform = process.platform, fallbackHome = (0, node_os.homedir)()) {
	const path = platform === "win32" ? node_path.win32 : node_path.posix;
	const home = (platform === "win32" ? env.USERPROFILE : env.HOME)?.trim() || fallbackHome;
	return path.join(home, ".zcode", "cli", "setting.json");
}
function desktopSettingsPath(env = process.env) {
	return (0, node_path.join)((0, node_path.dirname)((0, node_path.dirname)(cliSettingsPath(env))), "v2", "setting.json");
}
function readDesktopSettings(env = process.env) {
	try {
		const value = JSON.parse((0, node_fs.readFileSync)(desktopSettingsPath(env), "utf8"));
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid settings object");
		return value;
	} catch (error) {
		if (error.code === "ENOENT") return {};
		throw new Error("Unable to read Desktop setting.json; the file was left unchanged.");
	}
}
function sharedDataBaseDir(env = process.env, platform = process.platform, fallbackHome = (0, node_os.homedir)()) {
	const home = (platform === "win32" ? env.USERPROFILE : env.HOME)?.trim() || fallbackHome;
	const desktop = platform === process.platform ? readDesktopSettings(env).dataBaseDir : void 0;
	return env.ZCODE_DATA_BASE_DIR?.trim() || typeof desktop === "string" && desktop.trim() || home;
}
function providerConfigPath(env = process.env, platform = process.platform, fallbackHome = (0, node_os.homedir)()) {
	const path = platform === "win32" ? node_path.win32 : node_path.posix;
	return env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE?.trim() || path.join(sharedDataBaseDir(env, platform, fallbackHome), ".zcode", "v2", "provider_config.json");
}
function legacyCliConfigPath(env = process.env) {
	return (0, node_path.join)((0, node_path.dirname)(cliSettingsPath(env)), "config.json");
}
function providerMigrationMarkerPath(env = process.env) {
	const target = (0, node_crypto.createHash)("sha256").update(providerConfigPath(env)).digest("hex").slice(0, 16);
	return (0, node_path.join)((0, node_path.dirname)(cliSettingsPath(env)), "migrations", `provider-registry-${target}.json`);
}
//#endregion
//#region src/session-model-recovery.ts
/** sessionEntries already unwraps the stored modelSelection; legacy sibling fields are not authoritative. */
function inspectSelection(registry, value) {
	const selection = value && typeof value === "object" && !Array.isArray(value) && "providerId" in value && typeof value.providerId === "string" && value.providerId.trim() && "modelId" in value && typeof value.modelId === "string" && value.modelId.trim() ? value : void 0;
	const model = selection ? `${selection.providerId}/${selection.modelId}` : "(not selected)";
	const validation = selection ? registry.validateSelection(selection) : {
		ok: false,
		code: "selection-missing"
	};
	const state = {
		model,
		selection,
		thoughtLevel: selection?.options?.reasoningLevel,
		effortOptions: selection ? registry.getModel(selection.providerId, selection.modelId)?.config.optionSpecs.reasoningLevel.values ?? [] : []
	};
	if (validation.ok) return state;
	const code = validation.code ?? "selection-invalid";
	const reason = {
		"provider-not-found": "the provider is unavailable",
		"model-not-found": "the model is not in the current provider catalog",
		"reasoning-level-missing": "the reasoning level is missing",
		"reasoning-level-not-supported": "the saved reasoning level is no longer supported",
		"selection-missing": "no model selection was saved"
	}[code] ?? "the saved selection is invalid";
	return {
		...state,
		issue: {
			code,
			message: `Saved model ${JSON.stringify(model)} cannot be used: ${reason}.`
		}
	};
}
/** Inspect without changing the session, its credentials, or the shared default. */
async function readSessionModelState(options) {
	const entries = await options.sessionStore.sessionEntries({
		sessionID: options.sessionId,
		type: "runtime/model_selection"
	});
	return entries.length ? inspectSelection(options.registry, entries.at(-1)?.data) : void 0;
}
/** Fail before model creation so headless callers retain the cause and recovery instructions. */
function assertSessionModelReady(options) {
	if (!options.restored || options.currentSelection && options.registry.validateSelection(options.currentSelection).ok) return;
	const state = inspectSelection(options.registry, options.restored.selection);
	if (state.issue) throw new Error(`${state.issue.message} Resume interactively with zcode --resume ${options.sessionId} and use /model to choose a replacement. No model request was sent.`);
}
//#endregion
//#region src/runtime-config-bridge.ts
function record(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
/** Desktop preferences supply defaults; explicit CLI and project settings still win. */
function mergeDesktopSettings(value, filePath, env = process.env) {
	const settings = record(value);
	if (!settings || (0, node_path.resolve)(filePath) !== (0, node_path.resolve)(cliSettingsPath(env))) return value;
	const desktop = readDesktopSettings(env);
	const locale = desktop.localePreference;
	const memory = typeof desktop.memoryEnabled === "boolean" ? desktop.memoryEnabled : void 0;
	const memorySettings = {
		...memory !== void 0 ? {
			use: memory,
			write: memory
		} : {},
		...record(settings.memory)
	};
	const memoryFeature = typeof memorySettings.use === "boolean" && typeof memorySettings.write === "boolean" ? memorySettings.use || memorySettings.write : memory;
	return {
		...settings,
		ui: {
			...typeof locale === "string" ? { locale } : {},
			...record(settings.ui)
		},
		memory: memorySettings,
		features: {
			...memoryFeature !== void 0 ? { memory: memoryFeature } : {},
			...record(settings.features)
		}
	};
}
function providerMigrationNeeded(env = process.env) {
	return (0, node_fs.existsSync)(legacyCliConfigPath(env)) && !(0, node_fs.existsSync)(providerMigrationMarkerPath(env));
}
/** Uses the upstream parser and file-locked repository, rather than editing shared JSON. */
async function migrateLegacyProviders(options) {
	const env = options.env ?? process.env;
	if (!providerMigrationNeeded(env)) return;
	let legacy;
	try {
		legacy = record(JSON.parse(await (0, node_fs_promises.readFile)(legacyCliConfigPath(env), "utf8")));
	} catch {
		throw new Error("Legacy provider config could not be read; no provider settings were changed.");
	}
	if (!legacy) throw new Error("Legacy provider config must be an object.");
	const imported = [], skipped = [];
	const candidates = [];
	for (const [id, raw] of Object.entries(record(legacy.provider) ?? {})) {
		const provider = record(raw), key = record(provider?.options)?.apiKey;
		const builtinApi = id === "builtin:zai" || id === "builtin:bigmodel";
		if (!provider || id.startsWith("account:") || id.startsWith("builtin:") && !builtinApi || provider.source !== void 0 && provider.source !== "custom" && !builtinApi || typeof key === "string" && key.startsWith("enc:") || (builtinApi || id.startsWith("default-")) && !(typeof key === "string" && key.trim())) {
			skipped.push(id);
			continue;
		}
		try {
			const candidate = options.importLegacy({ input: { provider: { [id]: provider } } });
			let providers = candidate.providers;
			for (const rule of candidate.providers.rules()) if (typeof provider.enabled === "boolean") providers = providers.setRule({
				...rule,
				enabled: provider.enabled
			});
			candidates.push({
				...candidate,
				providers
			});
		} catch {
			skipped.push(id);
		}
	}
	let recovery = false;
	const repository = new options.Repository({
		filePath: providerConfigPath(env),
		pollingIntervalMs: false,
		onRecovery: () => {
			recovery = true;
		}
	});
	try {
		const current = await repository.read();
		if (recovery) throw new Error("The shared provider config needs recovery; it was left unchanged.");
		if (candidates.some((candidate) => candidate.providers.rules().some((rule) => !current.providers.has(rule.providerId)))) await repository.update((snapshot) => {
			let { providers, models } = snapshot;
			for (const candidate of candidates) for (const rule of candidate.providers.rules()) {
				if (providers.has(rule.providerId)) continue;
				providers = providers.setRule(rule);
				for (const model of candidate.models.rules()) if (model.providerId === rule.providerId && !models.getExactRule(model.providerId, model.modelId)) models = models.setExact(model.providerId, model.modelId, model.config);
				imported.push(rule.providerId);
			}
			return {
				...snapshot,
				providers,
				models
			};
		});
	} finally {
		repository.dispose();
	}
	const marker = providerMigrationMarkerPath(env), temporary = `${marker}.${process.pid}.tmp`;
	await (0, node_fs_promises.mkdir)((0, node_path.dirname)(marker), {
		recursive: true,
		mode: 448
	});
	try {
		await (0, node_fs_promises.writeFile)(temporary, JSON.stringify({
			schemaVersion: 1,
			imported,
			skipped,
			completedAt: (/* @__PURE__ */ new Date()).toISOString()
		}), { mode: 384 });
		await (0, node_fs_promises.rename)(temporary, marker);
	} finally {
		await (0, node_fs_promises.rm)(temporary, { force: true });
	}
}
//#endregion
exports.assertSessionModelReady = assertSessionModelReady;
exports.mergeDesktopSettings = mergeDesktopSettings;
exports.migrateLegacyProviders = migrateLegacyProviders;
exports.providerMigrationNeeded = providerMigrationNeeded;
exports.readSessionModelState = readSessionModelState;
