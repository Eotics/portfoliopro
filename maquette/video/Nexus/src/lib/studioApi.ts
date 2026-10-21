import { invoke } from "@tauri-apps/api/core";
import type { Colors, Look } from "./look";

export interface ImportOpts {
  name: string;
  category: string;
  zIndex?: number | null;
  tintable: boolean;
  mirrorable: boolean;
  duplicable: boolean;
  scale?: number | null;
  anchorX?: number | null;
  anchorY?: number | null;
}

export interface ComboSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentVersion: number;
  versions: number;
  data: ComboData | null;
}
/** A combo stores the full layer configuration (never a flattened image). */
export interface ComboData {
  layers: Look["layers"];
  expressionMap?: Look["expressionMap"];
  animationMap?: Look["animationMap"];
}
export interface ComboDetail {
  id: string;
  name: string;
  currentVersion: number;
  versions: { version: number; createdAt: string; data: ComboData }[];
}
export interface ProfileData {
  look: Look;
  size: "s" | "m" | "l";
  position?: [number, number] | null;
  comboId?: string | null;
}
export interface Profile {
  id: string;
  name: string;
  data: ProfileData;
  updatedAt: string;
}

export const studio = {
  getLook: () => invoke<Look | null>("studio_get_look"),
  setLook: (look: Look) => invoke<void>("studio_set_look", { look }),
  favorite: (id: string, favorite: boolean) => invoke<void>("studio_set_favorite", { id, favorite }),
  touch: (id: string) => invoke<void>("studio_touch", { id }),
  importAsset: (path: string, opts: ImportOpts) => invoke<string>("studio_import_asset", { path, opts }),
  createAsset: (svg: string, opts: ImportOpts, colors: Colors) => invoke<string>("studio_create_asset", { svg, opts, colors }),
  updateAsset: (id: string, patch: Record<string, unknown>) => invoke<void>("studio_update_asset", { id, patch }),
  duplicateAsset: (id: string) => invoke<string>("studio_duplicate_asset", { id }),
  deleteAsset: (id: string) => invoke<void>("studio_delete_asset", { id }),
  exportAsset: (id: string, destDir: string) => invoke<string>("studio_export_asset", { id, destDir }),
  openFolder: () => invoke<void>("studio_open_folder"),
  listCombos: () => invoke<ComboSummary[]>("studio_list_combos"),
  saveCombo: (comboId: string | null, name: string, data: ComboData) => invoke<{ id: string; version: number }>("studio_save_combo", { comboId, name, data }),
  getCombo: (id: string) => invoke<ComboDetail>("studio_get_combo", { id }),
  restoreVersion: (id: string, version: number) => invoke<ComboData>("studio_restore_version", { id, version }),
  duplicateVersion: (id: string, version: number) => invoke<number>("studio_duplicate_version", { id, version }),
  deleteVersion: (id: string, version: number) => invoke<void>("studio_delete_version", { id, version }),
  renameCombo: (id: string, name: string) => invoke<void>("studio_rename_combo", { id, name }),
  deleteCombo: (id: string) => invoke<void>("studio_delete_combo", { id }),
  exportCombo: (name: string, data: ComboData, dest: string) => invoke<string>("studio_export_combo", { name, data, dest }),
  importCombo: (path: string) => invoke<{ combo: { id: string; version: number }; data: ComboData; importedAssets: number }>("studio_import_combo", { path }),
  listProfiles: () => invoke<{ profiles: Profile[]; active: string | null }>("studio_list_profiles"),
  saveProfile: (id: string | null, name: string, data: ProfileData) => invoke<string>("studio_save_profile", { id, name, data }),
  deleteProfile: (id: string) => invoke<void>("studio_delete_profile", { id }),
  activateProfile: (id: string) => invoke<ProfileData>("studio_activate_profile", { id }),
  companionPosition: () => invoke<[number, number] | null>("companion_position"),
};
