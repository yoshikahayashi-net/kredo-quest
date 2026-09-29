# クレドクエスト 10/12 リリースチェック

## 実装済み
- [x] GitHub Pages公開基盤
- [x] Supabase認証接続
- [x] アカウント／表示名
- [x] Day1〜Day5 本番問題バンク（30問）
- [x] 日替わりクエスト
- [x] 通常クイズ＋解説＋BOSS
- [x] 参加10pt＋正解2pt/問＋BOSS5pt
- [x] 同日重複参加の防止
- [x] ランキング
- [x] マイページ
- [x] クイズJSON/CSV取り込み
- [x] アカウント別ローカル状態
- [x] BOSS正解後の回答固定
- [x] クイズ進捗表示／下部ナビ修正
- [x] 本番用Supabase SQL/RPCを supabase_schema_kredo_quest.sql に追加
- [x] index.html JavaScript構文チェック済み
- [x] 公式「抱月クレド」ページをゲーム内に埋め込み
- [x] 社員向け画面からクイズ編集・取り込み機能を非表示化
- [x] ログアウト／パスワード再設定導線

## 10/12までに残す作業
1. Supabaseで supabase_schema_kredo_quest.sql を実行
2. Supabase Authentication の Site URL / Redirect URL をGitHub Pagesの本番URLに合わせる
3. 社員向けテストアカウントで「登録→ログイン→クイズ→BOSS→ポイント→ランキング」を通す
4. iPhone Safari / Android Chrome / PC Chromeで表示・操作確認
5. クイズ問題・正解・解説・クレド表記を最終校正
6. 公式キャラクター表示を納品版として最終確認
7. GitHub Pages本番URLでトップ→クレドを知る→クイズ→結果→マイページ→ランキングを通し確認

## 本番前の注意
- SQL未実行では、本番アカウントのポイント記録は完了しない
- SQL実行後は、ポイント加算を record_quest_attempt RPC 経由にする
- profiles.total_points はサーバー側RPCで更新する
- 現在のクライアントはRPC未設定時に旧ポイント処理へフォールバックしない
- 問題バンクの編集・取り込みは社員向け画面から非表示化している
- クレド公式ページは外部サイト埋め込み＋別タブ導線を用意している
