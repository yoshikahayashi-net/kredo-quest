-- クレドクエスト：ホウゲツカフェ2人分の交換を一時停止
-- Supabase SQL Editorで一度だけ実行してください。
-- 既存ユーザーのポイントや交換履歴は変更しません。

create or replace function public.kredo_block_paused_reward()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.reward_id = 'cafe2' then
    raise exception 'reward_not_available' using errcode = '22023';
  end if;
  return new;
end;
$function$;

drop trigger if exists block_paused_cafe_two_reward on public.kredo_reward_redemptions;
create trigger block_paused_cafe_two_reward
before insert on public.kredo_reward_redemptions
for each row execute function public.kredo_block_paused_reward();

revoke all on function public.kredo_block_paused_reward() from public, anon, authenticated;
