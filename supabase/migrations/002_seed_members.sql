-- ============================================================
-- Fundex SAVINGS - MEMBER SEED SCRIPT
-- Run this in Supabase SQL Editor AFTER running the main migration
-- This creates the initial member profiles
--
-- IMPORTANT: You must first create auth users manually in:
--   Supabase Dashboard → Authentication → Users → Add User
--
--   Create these three users:
--   1. Email: collins.towett@Fundex.app  | Password: (set strong password)
--   2. Email: gilbert.langat@Fundex.app  | Password: (set strong password)
--   3. Email: amos.korir@Fundex.app      | Password: (set strong password)
--
-- After creating auth users, get their UUIDs from the auth.users table
-- and replace the placeholders below.
-- ============================================================

-- Step 1: After creating auth users, run this to get their IDs:
-- SELECT id, email FROM auth.users ORDER BY created_at;

-- Step 2: Update profiles with correct names and roles
-- (The trigger should have already created profiles, so we just UPDATE)

-- Replace 'COLLINS_UUID_HERE' etc with actual UUIDs from auth.users

/*
UPDATE profiles SET
  name = 'Collins K. Towett',
  role = 'admin'
WHERE email = 'collins.towett@Fundex.app';

UPDATE profiles SET
  name = 'Gilbert K. Lang''at',
  role = 'member'
WHERE email = 'gilbert.langat@Fundex.app';

UPDATE profiles SET
  name = 'Amos K. Korir',
  role = 'member'
WHERE email = 'amos.korir@Fundex.app';
*/

-- Step 3: Verify the profiles look correct:
-- SELECT id, name, email, role, created_at FROM profiles ORDER BY created_at;

-- ============================================================
-- ALTERNATIVE: If you prefer to set name during signup,
-- pass metadata when calling supabase.auth.signUp():
--
-- await supabase.auth.signUp({
--   email: 'collins.towett@Fundex.app',
--   password: 'strongpassword123',
--   options: {
--     data: {
--       name: 'Collins K. Towett',
--       role: 'admin'
--     }
--   }
-- })
-- ============================================================
