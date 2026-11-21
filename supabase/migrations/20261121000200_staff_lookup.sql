-- Owner-only lookup of a user id by email (staff invites for existing accounts).
create function public.admin_find_user_id(p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_owner_aal2() and public.has_recent_mfa(300)) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return (select u.id from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1);
end;
$$;

revoke execute on function public.admin_find_user_id(text) from public, anon;
grant execute on function public.admin_find_user_id(text) to authenticated;
