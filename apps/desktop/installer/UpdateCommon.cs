using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;


// 司法院裁判研究 ・ 線上更新與安裝共用函式庫
// 版本號與更新清單網址由 build_installer.ps1 產生的 BuildInfo.g.cs 提供
namespace JudgeResearch {
    public static class UpdateCommon {
        public const int ExitNoAction = 0;
        public const int ExitInstallerLaunched = 10;
        public const int ExitForcedDeclined = 20;

        static UpdateCommon() {
            // .NET Framework 4.x 預設不啟用 TLS 1.2，GitHub 等主機會拒絕連線
            try {
                ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072 | (SecurityProtocolType)12288;
            } catch {
                try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; } catch { }
            }
        }

        public static string CurrentBuildVersion { get { return BuildInfo.Version; } }

        // 可用環境變數 DEBATE_UPDATE_URL 覆寫
        public static string ManifestUrl {
            get {
                string env = Environment.GetEnvironmentVariable("DEBATE_UPDATE_URL");
                return string.IsNullOrEmpty(env) ? BuildInfo.ManifestUrl : env;
            }
        }

        public static string StateDir {
            get {
                string d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "JudgeResearch");
                try { Directory.CreateDirectory(d); } catch { }
                return d;
            }
        }

        public static string DownloadDir {
            get {
                string d = Path.Combine(Path.GetTempPath(), "JudgeResearchUpdate");
                try { Directory.CreateDirectory(d); } catch { }
                return d;
            }
        }

        public static readonly string LogPath = Path.Combine(Path.GetTempPath(), "JudgeResearchUpdate.log");
        public static void Log(string msg) {
            try { File.AppendAllText(LogPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + msg + Environment.NewLine); } catch { }
        }

        // ───── 版本比較 ─────
        public static Version ParseVersion(string v) {
            if (string.IsNullOrEmpty(v)) return new Version(0, 0, 0);
            v = v.Trim().TrimStart('v', 'V');
            int cut = v.IndexOfAny(new[] { '-', '+', ' ' });
            if (cut >= 0) v = v.Substring(0, cut);
            string[] parts = v.Split('.');
            int[] n = new int[4];
            for (int i = 0; i < 4 && i < parts.Length; i++) {
                int x; int.TryParse(parts[i], out x); n[i] = Math.Max(0, x);
            }
            return new Version(n[0], n[1], n[2], n[3]);
        }

        public static bool IsNewer(string candidate, string current) {
            return ParseVersion(candidate) > ParseVersion(current);
        }

        // ───── 取得線上更新清單 ─────
        // 清單來源：鏡像優先，GitHub 備援。
        public static List<string> ManifestUrls() {
            var list = new List<string>();
            if (!string.IsNullOrEmpty(ManifestUrl)) list.Add(ManifestUrl);
            string fb = BuildInfo.ManifestFallbackUrl;
            if (!string.IsNullOrEmpty(fb) && !list.Contains(fb)) list.Add(fb);
            return list;
        }

        public static UpdateManifest FetchManifest(int timeoutMs) {
            Exception last = null;
            foreach (string u in ManifestUrls()) {
                try { return FetchManifestFrom(u, timeoutMs); }
                catch (Exception ex) { last = ex; Log("Manifest from " + u + " failed: " + ex.Message); }
            }
            throw last ?? new InvalidOperationException("Update manifest URL not configured");
        }

        static UpdateManifest FetchManifestFrom(string url, int timeoutMs) {
            if (string.IsNullOrEmpty(url)) throw new InvalidOperationException("Update manifest URL not configured");
            if (url.StartsWith("http", StringComparison.OrdinalIgnoreCase)) {
                url += (url.Contains("?") ? "&" : "?") + "t=" + DateTime.UtcNow.Ticks;
            }
            WebRequest req = WebRequest.Create(url);
            req.Timeout = timeoutMs;
            HttpWebRequest http = req as HttpWebRequest;
            if (http != null) {
                http.ReadWriteTimeout = timeoutMs;
                http.UserAgent = "JudgeResearch-Updater/" + CurrentBuildVersion;
                http.AllowAutoRedirect = true;
                http.KeepAlive = false;
                http.CachePolicy = new System.Net.Cache.RequestCachePolicy(System.Net.Cache.RequestCacheLevel.NoCacheNoStore);
            }
            string json;
            using (WebResponse resp = req.GetResponse())
            using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) {
                json = sr.ReadToEnd();
            }
            return ParseManifest(json);
        }

        public static UpdateManifest ParseManifest(string json) {
            var ser = new JavaScriptSerializer();
            var d = ser.DeserializeObject(json.TrimStart('\uFEFF')) as Dictionary<string, object>;
            if (d == null) throw new FormatException("Invalid manifest");
            var m = new UpdateManifest {
                Version = Str(d, "version"),
                MinimumVersion = Str(d, "minimumVersion"),
                Mandatory = Bool(d, "mandatory"),
                InstallerUrl = Str(d, "installerUrl"),
                InstallerMirrorUrl = Str(d, "installerMirrorUrl"),
                Sha256 = Str(d, "sha256"),
                ReleaseDate = Str(d, "releaseDate")
            };
            long size; long.TryParse(Str(d, "size") ?? "0", out size); m.Size = size;
            m.InstallerVersion = Str(d, "installerVersion");
            m.PayloadUrl = Str(d, "payloadUrl");
            m.PayloadMirrorUrl = Str(d, "payloadMirrorUrl");
            m.PayloadSha256 = Str(d, "payloadSha256");
            long psize; long.TryParse(Str(d, "payloadSize") ?? "0", out psize); m.PayloadSize = psize;
            object notes;
            if (d.TryGetValue("notes", out notes)) {
                var nd = notes as Dictionary<string, object>;
                if (nd != null) { m.NotesZh = Str(nd, "zh"); m.NotesEn = Str(nd, "en"); }
                else if (notes != null) { m.NotesZh = m.NotesEn = notes.ToString(); }
            }
            if (string.IsNullOrEmpty(m.Version) || string.IsNullOrEmpty(m.InstallerUrl))
                throw new FormatException("Manifest missing version or installerUrl");
            return m;
        }

        static string Str(Dictionary<string, object> d, string k) {
            object v; return d.TryGetValue(k, out v) && v != null ? Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture) : null;
        }
        static bool Bool(Dictionary<string, object> d, string k) {
            object v; if (!d.TryGetValue(k, out v) || v == null) return false;
            if (v is bool) return (bool)v;
            bool b; return bool.TryParse(v.ToString(), out b) && b;
        }

        // ───── 下載與驗證 ─────
        public static void DownloadFile(string url, string dest, long expectedSize, Action<long, long> progress, Func<bool> cancel) {
            string part = dest + ".part";
            WebRequest req = WebRequest.Create(url);
            req.Timeout = 30000;
            HttpWebRequest http = req as HttpWebRequest;
            if (http != null) {
                http.ReadWriteTimeout = 60000;
                http.UserAgent = "JudgeResearch-Updater/" + CurrentBuildVersion;
                http.AllowAutoRedirect = true;
                http.KeepAlive = false;
            }
            using (WebResponse resp = req.GetResponse()) {
                long total = resp.ContentLength > 0 ? resp.ContentLength : expectedSize;
                using (Stream src = resp.GetResponseStream())
                using (FileStream fs = new FileStream(part, FileMode.Create, FileAccess.Write)) {
                    byte[] buf = new byte[81920];
                    long done = 0;
                    int read;
                    DateTime last = DateTime.MinValue;
                    while ((read = src.Read(buf, 0, buf.Length)) > 0) {
                        if (cancel != null && cancel()) throw new OperationCanceledException();
                        fs.Write(buf, 0, read);
                        done += read;
                        if (progress != null && (DateTime.Now - last).TotalMilliseconds > 120) {
                            last = DateTime.Now;
                            progress(done, total);
                        }
                    }
                    if (progress != null) progress(done, total);
                }
            }
            if (File.Exists(dest)) File.Delete(dest);
            File.Move(part, dest);
        }

        public static string Sha256Of(string path) {
            using (var sha = SHA256.Create())
            using (var fs = File.OpenRead(path)) {
                byte[] h = sha.ComputeHash(fs);
                var sb = new StringBuilder(h.Length * 2);
                foreach (byte b in h) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }

        public static void VerifyInstaller(string path, UpdateManifest m) {
            using (var fs = File.OpenRead(path)) {
                if (fs.Length < 1024 || fs.ReadByte() != 'M' || fs.ReadByte() != 'Z')
                    throw new InvalidDataException("Downloaded file is not a valid executable");
            }
            if (!string.IsNullOrEmpty(m.Sha256)) {
                string actual = Sha256Of(path);
                if (!string.Equals(actual, m.Sha256.Trim(), StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("SHA-256 mismatch");
            }
        }

        public static string InstallerDownloadPath(UpdateManifest m) {
            return Path.Combine(DownloadDir, "JudgeResearchSetup-" + ParseVersion(m.Version).ToString(3) + ".exe");
        }

        // ── 只更新 App（payload）所需：安裝程式快取與版本判斷 ──
        public static string InstallerCacheDir {
            get {
                string d = Path.Combine(StateDir, "installer-cache");
                try { Directory.CreateDirectory(d); } catch { }
                return d;
            }
        }
        static string CachedInstallerExe { get { return Path.Combine(InstallerCacheDir, "JudgeResearchSetup.exe"); } }
        static string CachedInstallerMeta { get { return Path.Combine(InstallerCacheDir, "installer-cache.json"); } }

        // 快取完整安裝程式（版本與 SHA-256 寫入 sidecar）；之後同版本的 App 更新直接沿用。
        public static void SaveInstallerCache(string exePath, string installerVersion) {
            if (string.IsNullOrEmpty(installerVersion)) return;
            try {
                string tmp = CachedInstallerExe + ".tmp";
                File.Copy(exePath, tmp, true);
                string sha = Sha256Of(tmp);
                File.Copy(tmp, CachedInstallerExe, true);
                File.Delete(tmp);
                var meta = new Dictionary<string, object> { { "installerVersion", installerVersion }, { "sha256", sha } };
                File.WriteAllText(CachedInstallerMeta, new JavaScriptSerializer().Serialize(meta), Encoding.UTF8);
            } catch (Exception ex) { Log("Installer cache save failed: " + ex.Message); }
        }

        // 取得可用的快取安裝程式（版本相同且雜湊吻合）；否則回傳 null。
        public static string UsableCachedInstaller(string installerVersion) {
            try {
                if (string.IsNullOrEmpty(installerVersion) || !File.Exists(CachedInstallerExe) || !File.Exists(CachedInstallerMeta)) return null;
                var d = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(CachedInstallerMeta, Encoding.UTF8)) as Dictionary<string, object>;
                if (d == null) return null;
                if (!string.Equals(Str(d, "installerVersion"), installerVersion, StringComparison.Ordinal)) return null;
                string want = Str(d, "sha256");
                if (string.IsNullOrEmpty(want) || !string.Equals(Sha256Of(CachedInstallerExe), want, StringComparison.OrdinalIgnoreCase)) return null;
                return CachedInstallerExe;
            } catch (Exception ex) {
                Log("Installer cache check failed: " + ex.Message);
                return null;
            }
        }

        // 目前安裝所用的安裝程式版本（安裝時寫入 installer.version）；舊版安裝沒有此檔，回傳 null。
        public static string InstalledInstallerVersion() {
            try {
                string p = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "installer.version");
                return File.Exists(p) ? File.ReadAllText(p, Encoding.UTF8).Trim() : null;
            } catch { return null; }
        }

        // 只更新 App 的條件：非強制版、安裝程式版本與已安裝的相同、快取可用，且清單提供 payload。
        public static bool CanUsePayloadUpdate(UpdateManifest m, bool forced) {
            if (forced || m == null) return false;
            if (string.IsNullOrEmpty(m.InstallerVersion) || string.IsNullOrEmpty(m.PayloadSha256)) return false;
            if (m.PayloadUrls().Count == 0) return false;
            if (!string.Equals(InstalledInstallerVersion(), m.InstallerVersion, StringComparison.Ordinal)) return false;
            return UsableCachedInstaller(m.InstallerVersion) != null;
        }

        public static string PayloadDownloadPath(UpdateManifest m) {
            return Path.Combine(DownloadDir, "JudgeResearchPayload-" + ParseVersion(m.Version).ToString(3) + ".zip");
        }

        // 校驗任意下載檔案（大小與 SHA-256）。
        public static void VerifyFile(string path, string sha256, long size) {
            var fi = new FileInfo(path);
            if (!fi.Exists) throw new FileNotFoundException("Downloaded file is missing", path);
            if (size > 0 && fi.Length != size) throw new InvalidDataException("Size mismatch");
            if (!string.IsNullOrEmpty(sha256) && !string.Equals(Sha256Of(path), sha256.Trim(), StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("SHA-256 mismatch");
        }

        public static void CleanupOldDownloads() {
            try {
                string self = System.Reflection.Assembly.GetExecutingAssembly().Location;
                foreach (string f in Directory.GetFiles(DownloadDir)) {
                    if (string.Equals(f, self, StringComparison.OrdinalIgnoreCase)) continue;
                    try { if ((DateTime.Now - File.GetLastWriteTime(f)).TotalDays > 1) File.Delete(f); } catch { }
                }
            } catch { }
        }

        public static string FormatSize(long bytes) {
            if (bytes <= 0) return "—";
            return (bytes / 1024.0 / 1024.0).ToString("0.0") + " MB";
        }

        public static string Quote(string arg) {
            return "\"" + (arg ?? "").Replace("\"", "\\\"") + "\"";
        }

        [DllImport("shell32.dll")]
        public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);

        public static void NotifyShell() {
            try {
                SHChangeNotify(0x08000000, 0x1000, IntPtr.Zero, IntPtr.Zero);
            } catch { }
        }
    }
}
