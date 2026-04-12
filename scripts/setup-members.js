#!/usr/bin/env node
/**
 * Fundex SAVINGS - Initial Setup Script
 * 
 * Run this once to create the three member accounts in Supabase.
 * 
 * Usage:
 *   node scripts/setup-members.js
 * 
 * Prerequisites:
 *   npm install @supabase/supabase-js dotenv
 *   Create .env.local with VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabaseUrl = process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY // Use service role for admin operations

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const MEMBERS = [
  {
    email: 'colltrek2@gmail.com',
    password: 'Admin@2026!', // Change before use!
    name: 'Collins Towett',
    role: 'admin'
  },
  {
    email: 'kipngenogili@gmail.com',
    password: 'Langat@2026!', // Change before use!
    name: "Gilbert Lang'at",
    role: 'member'
  },
  {
    email: 'korir.sagit@gmail.com',
    password: 'Korir@2026!', // Change before use!
    name: 'Amos Korir',
    role: 'member'
  }
]

async function setupMembers() {
  console.log('🚀 Setting up Fundex Savings members...\n')

  for (const member of MEMBERS) {
    console.log(`Creating: ${member.name} (${member.email})...`)

    // Create auth user with admin API
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: member.email,
      password: member.password,
      email_confirm: true,
      user_metadata: {
        name: member.name,
        role: member.role
      }
    })

    if (authError) {
      console.error(`  ❌ Failed to create auth user: ${authError.message}`)
      continue
    }

    console.log(`  ✅ Auth user created: ${authData.user.id}`)

    // Update profile (trigger should have created it, but let's ensure)
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: authData.user.id,
        name: member.name,
        email: member.email,
        role: member.role
      })

    if (profileError) {
      console.error(`  ⚠️  Profile update warning: ${profileError.message}`)
    } else {
      console.log(`  ✅ Profile set: ${member.name} | Role: ${member.role}`)
    }
    console.log()
  }

  console.log('✅ Setup complete!')
  console.log('\nIMPORTANT: Share these login credentials securely with each member:')
  MEMBERS.forEach(m => {
    console.log(`  ${m.name}: ${m.email} / ${m.password}`)
  })
  console.log('\n⚠️  Remind each member to change their password on first login!')
}

setupMembers().catch(console.error)
