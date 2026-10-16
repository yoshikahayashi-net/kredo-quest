# アバター素材の受け入れ仕様

このフォルダには、独立したアバター試作の素材を保管します。本体のクエスト・ポイント・Supabaseには接続しません。

## 1. 選択画面用のサムネイル

`catalog/` 内の20枚のWebPは、共有されたアバターカスタマイズ画面のスクリーンショットから、既存の見本画像を切り出して背景透過したものです。選択肢に表示するサムネイルとして追加しています。

- `catalog/hair/`: 髪型の見本3点と髪色の参考2点
- `catalog/outfit/`: 服装の見本5点
- `catalog/accessory/`: アクセサリーの見本5点
- `catalog/expression/`: 表情の見本5点

これらは低解像度の選択用画像です。特に髪型・表情の画像には顔や頭部の一部が含まれるため、キャラクターへ重ねる着せ替えレイヤーには使いません。服装の見本も、胴体に合わせて着用させる服パーツではありません。

## 2. マイルーム用の画像

`room/themes/` 内の5枚は、共有されたコンセプト画面下部の「部屋の一例」から切り出した部屋テーマの参考サムネイルです。マイルームのテーマ選択カードに表示します。

- `room/themes/basic.webp`
- `room/themes/nature.webp`
- `room/themes/workshop.webp`
- `room/themes/future.webp`
- `room/themes/credo.webp`

`room/furniture/` 内の5枚は、同じコンセプト画像の家具・小物の見本から切り出した画像です。選択用カタログに表示します。

- `room/furniture/desk.webp`
- `room/furniture/chair.webp`
- `room/furniture/plant.webp`
- `room/furniture/bookshelf.webp`
- `room/furniture/poster.webp`

部屋テーマは選択カードに表示する参考画像で、部屋全体の背景は現在CSSによる仮表示です。`room/sprites/` にはデスク・チェア・本棚・ポスターの4点を、選択カードの背景を除いた配置用スプライトとして追加しています。植物などの配置素材が未準備の家具は従来のアイコン表示を維持します。テーマサムネイル・カタログサムネイル・配置用スプライトは用途別に管理し、正式な部屋背景と家具素材へ段階的に置き換えます。

## 3. 着せ替え本体に必要な素材

実際の見た目を正しく切り替えるには、キャラクターの位置とキャンバスサイズをそろえた個別の透過PNGが必要です。推奨サイズは共通キャンバス 512 × 768 px、PNG、RGBA。透明余白の自動トリミングは避け、すべて同じ人物アンカーに合わせてください。

```
avatar/
  body/base.png
  head/base.png
  face/eyes/{expression}-eyes.png
  face/mouth/{expression}-mouth.png
  hair/{hairStyle}/{hairColor}-back.png
  hair/{hairStyle}/{hairColor}-front.png
  outfits/{outfit}.png
  accessories/{accessory}.png
  effects/{effect}.png
```

レイヤー順とIDの定義は `avatar-parts.manifest.json` が正本です。キャラクター全体の別イラストを作るのではなく、元の公式キャラクターから分けられる素材を優先します。

## 4. 現在の表示ルール

選択画面では `catalog/` の見本画像を表示します。一方、中央のキャラクタープレビューは元画像を加工せずそのまま表示します。部位別の正式素材がそろい、必須レイヤーがすべて読み込めた時点でのみ、合成プレビューに切り替える設計です。

現在のサムネイル追加をもって「キャラクターの着せ替えが完成した」とは扱いません。不足している体・頭部・目・口・前後の髪・全身に合う衣服は、引き続き別工程として整理します。
