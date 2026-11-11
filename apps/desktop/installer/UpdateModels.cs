using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace JudgeResearch {
    public class UpdateManifest {
        public string Version;
        public string MinimumVersion;
        public bool Mandatory;
        public string InstallerUrl;
        public string InstallerMirrorUrl;
        // 下載來源順序：鏡像（Firebase Storage）優先，GitHub 為備援；每個來源都必須通過 SHA-256 校驗。
        public List<string> InstallerUrls() {
            var list = new List<string>();
            if (!string.IsNullOrEmpty(InstallerMirrorUrl)) list.Add(InstallerMirrorUrl);
            if (!string.IsNullOrEmpty(InstallerUrl) && !list.Contains(InstallerUrl)) list.Add(InstallerUrl);
            return list;
        }
        public string Sha256;
        public long Size;
        // 安裝程式本身的版本（只有安裝器／更新器程式碼改變時才遞增）；與目前安裝的版本相同時，App 更新只需下載 payload。
        public string InstallerVersion;
        public string PayloadUrl;
        public string PayloadMirrorUrl;
        public string PayloadSha256;
        public long PayloadSize;
        public List<string> PayloadUrls() {
            var list = new List<string>();
            if (!string.IsNullOrEmpty(PayloadMirrorUrl)) list.Add(PayloadMirrorUrl);
            if (!string.IsNullOrEmpty(PayloadUrl) && !list.Contains(PayloadUrl)) list.Add(PayloadUrl);
            return list;
        }
        public string ReleaseDate;
        public string NotesZh;
        public string NotesEn;

        public string Notes(string lang) {
            string n = (lang == "en") ? NotesEn : NotesZh;
            return string.IsNullOrEmpty(n) ? (NotesZh ?? NotesEn ?? "") : n;
        }

        // 強制更新：清單標示 mandatory，或目前版本低於最低支援版本
        public bool IsForcedFor(string currentVersion) {
            if (!UpdateCommon.IsNewer(Version, currentVersion)) return false;
            if (Mandatory) return true;
            return !string.IsNullOrEmpty(MinimumVersion) && UpdateCommon.IsNewer(MinimumVersion, currentVersion);
        }
    }

    public class UpdateState {
        public long SnoozeUntilTicks;
        public string Lang;
        // 有新版時自動下載並啟動安裝（預設開啟；可在 update-state.json 將 autoInstall 設為 false 關閉）
        public bool AutoInstall = true;
        // 更新程式狀態（給主程式的設定頁顯示）：idle / checking / available / downloading / verifying / installing / error
        public string Phase = "idle";
        public string LastCheckUtc;
        public string LastCheckResult;
        public string LatestVersion;
        public string LastError;

        static string FilePath { get { return Path.Combine(UpdateCommon.StateDir, "update-state.json"); } }

        public static UpdateState Load() {
            var s = new UpdateState();
            try {
                if (File.Exists(FilePath)) {
                    var d = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(FilePath, Encoding.UTF8)) as Dictionary<string, object>;
                    if (d != null) {
                        object v;
                        if (d.TryGetValue("snoozeUntil", out v) && v != null) {
                            DateTime dt;
                            if (DateTime.TryParse(v.ToString(), System.Globalization.CultureInfo.InvariantCulture,
                                System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out dt))
                                s.SnoozeUntilTicks = dt.Ticks;
                        }
                        if (d.TryGetValue("lang", out v) && v != null) s.Lang = v.ToString();
                        if (d.TryGetValue("autoInstall", out v) && v is bool) s.AutoInstall = (bool)v;
                        if (d.TryGetValue("phase", out v) && v != null) s.Phase = v.ToString();
                        if (d.TryGetValue("lastCheckUtc", out v) && v != null) s.LastCheckUtc = v.ToString();
                        if (d.TryGetValue("lastCheckResult", out v) && v != null) s.LastCheckResult = v.ToString();
                        if (d.TryGetValue("latestVersion", out v) && v != null) s.LatestVersion = v.ToString();
                        if (d.TryGetValue("lastError", out v) && v != null) s.LastError = v.ToString();
                    }
                }
            } catch (Exception ex) { UpdateCommon.Log("State load failed: " + ex.Message); }
            return s;
        }

        public void Save() {
            try {
                var d = new Dictionary<string, object>();
                if (SnoozeUntilTicks > 0) d["snoozeUntil"] = new DateTime(SnoozeUntilTicks, DateTimeKind.Utc).ToString("o");
                if (!string.IsNullOrEmpty(Lang)) d["lang"] = Lang;
                d["autoInstall"] = AutoInstall;
                d["phase"] = Phase ?? "idle";
                if (!string.IsNullOrEmpty(LastCheckUtc)) d["lastCheckUtc"] = LastCheckUtc;
                if (!string.IsNullOrEmpty(LastCheckResult)) d["lastCheckResult"] = LastCheckResult;
                if (!string.IsNullOrEmpty(LatestVersion)) d["latestVersion"] = LatestVersion;
                if (!string.IsNullOrEmpty(LastError)) d["lastError"] = LastError;
                d["updatedUtc"] = DateTime.UtcNow.ToString("o");
                File.WriteAllText(FilePath, new JavaScriptSerializer().Serialize(d), new UTF8Encoding(false));
            } catch (Exception ex) { UpdateCommon.Log("State save failed: " + ex.Message); }
        }

        // 讀取→修改→寫回（單一寫入點，避免覆蓋其他欄位）。
        public static void Update(Action<UpdateState> change) {
            try { var s = Load(); change(s); s.Save(); } catch (Exception ex) { UpdateCommon.Log("State update failed: " + ex.Message); }
        }

        public bool IsSnoozed { get { return SnoozeUntilTicks > DateTime.UtcNow.Ticks; } }
        public DateTime SnoozeUntilLocal { get { return new DateTime(SnoozeUntilTicks, DateTimeKind.Utc).ToLocalTime(); } }
    }
}
