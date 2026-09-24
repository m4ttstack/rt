import Foundation
import SQLite3
import MattstackCore

/// Reads the dev app's checkout the way the daemon shim does: the state.db kv
/// row ns='dev-mode', k='config', else the legacy dev-mode.json, each only
/// when owned by this user and not group/other-writable, and read-only.
enum DevSourceConfigReader {
    static func read(home: String) -> DevSourceConfig? {
        let rtDir = home + "/.mattstack/rt"
        if let json = kvRow(dbPath: rtDir + "/state.db"), let config = DevSourceConfig.parse(json: json, home: home) {
            return config
        }
        let legacy = rtDir + "/dev-mode.json"
        guard isTrusted(legacy), let data = FileManager.default.contents(atPath: legacy) else { return nil }
        return DevSourceConfig.parse(json: String(decoding: data, as: UTF8.self), home: home)
    }

    private static func isTrusted(_ path: String) -> Bool {
        var st = stat()
        guard stat(path, &st) == 0, st.st_uid == getuid() else { return false }
        return (st.st_mode & (mode_t(S_IWGRP) | mode_t(S_IWOTH))) == 0
    }

    private static func kvRow(dbPath: String) -> String? {
        guard isTrusted(dbPath) else { return nil }
        var db: OpaquePointer?
        guard sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db else {
            sqlite3_close(db)
            return nil
        }
        defer { sqlite3_close(db) }
        sqlite3_busy_timeout(db, 2000)
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT v FROM kv WHERE ns = 'dev-mode' AND k = 'config';", -1, &stmt, nil) == SQLITE_OK,
              let stmt
        else {
            sqlite3_finalize(stmt)
            return nil
        }
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_step(stmt) == SQLITE_ROW, let text = sqlite3_column_text(stmt, 0) else { return nil }
        return String(cString: text)
    }
}
