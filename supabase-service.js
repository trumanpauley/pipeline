(function createPipelineSupabaseService() {
  const getClient = () => {
    if (!window.pipelineSupabase) {
      throw new Error('Supabase is not configured. Copy supabase-config.example.js to supabase-config.js and add your project values.');
    }
    return window.pipelineSupabase;
  };

  const readableError = error => {
    if (!error) return 'Something went wrong. Please try again.';
    if (error.code === '23505' || /username/i.test(error.message || '')) {
      return 'That username is already in use. Choose another one.';
    }
    return error.message || 'Something went wrong. Please try again.';
  };

  const withError = async operation => {
    try {
      return { data: await operation(), error: null };
    } catch (error) {
      return { data: null, error: new Error(readableError(error)) };
    }
  };

  window.pipelineSupabaseService = {
    isConfigured() {
      return Boolean(window.pipelineSupabase);
    },

    async getSession() {
      return withError(async () => {
        const { data, error } = await getClient().auth.getSession();
        if (error) throw error;
        return data.session;
      });
    },

    onAuthStateChange(callback) {
      if (!window.pipelineSupabase) return { data: { subscription: { unsubscribe() {} } } };
      return getClient().auth.onAuthStateChange(callback);
    },

    async signUp({ fullName, username, email, password }) {
      return withError(async () => {
        const { data, error } = await getClient().auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName, username: username.trim() } }
        });
        if (error) throw error;
        return data;
      });
    },

    async signIn({ email, password }) {
      return withError(async () => {
        const { data, error } = await getClient().auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data;
      });
    },

    async signOut() {
      return withError(async () => {
        const { error } = await getClient().auth.signOut();
        if (error) throw error;
        return true;
      });
    },

    async resetPassword(email) {
      return withError(async () => {
        const { error } = await getClient().auth.resetPasswordForEmail(email, {
          redirectTo: window.location.href
        });
        if (error) throw error;
        return true;
      });
    },

    async getOwnProfile(userId) {
      return withError(async () => {
        const { data, error } = await getClient()
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();
        if (error) throw error;
        return data;
      });
    },

    async getPublicProfile(userId) {
      return withError(async () => {
        const { data, error } = await getClient()
          .from('public_profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();
        if (error) throw error;
        return data;
      });
    },

    async updateOwnProfile(profile) {
      return withError(async () => {
        const { data, error } = await getClient()
          .from('profiles')
          .update(profile)
          .eq('id', profile.id)
          .select()
          .single();
        if (error) throw error;
        return data;
      });
    },

    async getProfileEntries(userId) {
      return withError(async () => {
        const { data, error } = await getClient()
          .from('profile_entries')
          .select('*')
          .eq('profile_id', userId);
        if (error) throw error;
        return data || [];
      });
    },

    async saveProfileEntries(entries) {
      return withError(async () => {
        if (!entries || !entries.length) return [];
        const { data, error } = await getClient()
          .from('profile_entries')
          .insert(entries)
          .select();
        if (error) throw error;
        return data;
      });
    },

    async saveGroupMemberships(memberships) {
      return withError(async () => {
        if (!memberships || !memberships.length) return [];
        const { data, error } = await getClient()
          .from('group_memberships')
          .insert(memberships)
          .select();
        if (error) throw error;
        return data;
      });
    },

    async joinGroup(userId, groupSlugOrId, status = 'self_reported') {
      return withError(async () => {
        const client = getClient();
        const { data: group } = await client
          .from('groups')
          .select('id, slug')
          .or(`slug.eq.${groupSlugOrId},id.eq.${groupSlugOrId}`)
          .maybeSingle();
        if (!group) return null;
        const { data, error } = await client
          .from('group_memberships')
          .upsert({ user_id: userId, group_id: group.id, status }, { onConflict: 'user_id, group_id' })
          .select()
          .single();
        if (error) throw error;
        return data;
      });
    },

    async leaveGroup(userId, groupSlugOrId) {
      return withError(async () => {
        const client = getClient();
        const { data: group } = await client
          .from('groups')
          .select('id, slug')
          .or(`slug.eq.${groupSlugOrId},id.eq.${groupSlugOrId}`)
          .maybeSingle();
        if (!group) return null;
        const { error } = await client
          .from('group_memberships')
          .delete()
          .eq('user_id', userId)
          .eq('group_id', group.id);
        if (error) throw error;
        return true;
      });
    },

    async getUserGroupMemberships(userId) {
      return withError(async () => {
        const client = getClient();
        const { data, error } = await client
          .from('group_memberships')
          .select('group_id, status, groups(id, slug, name)')
          .eq('user_id', userId);
        if (error) throw error;
        return data;
      });
    },

    async getGroupMembers(groupSlugOrId) {
      return withError(async () => {
        const client = getClient();
        const { data: group } = await client
          .from('groups')
          .select('id, slug, name')
          .or(`slug.eq.${groupSlugOrId},id.eq.${groupSlugOrId}`)
          .maybeSingle();
        if (!group) return [];

        const { data: memberships, error: memError } = await client
          .from('group_memberships')
          .select('user_id, status')
          .eq('group_id', group.id)
          .in('status', ['self_reported', 'verified']);
        if (memError) throw memError;
        if (!memberships || !memberships.length) return [];

        const userIds = memberships.map(m => m.user_id);
        const { data: profiles, error: profError } = await client
          .from('public_profiles')
          .select('id, username, full_name, headline, location, school_or_organization, major, graduation_year, bio, photo_path')
          .in('id', userIds);
        if (profError) throw profError;

        const profileMap = new Map((profiles || []).map(p => [p.id, p]));
        return memberships.map(m => ({
          userId: m.user_id,
          status: m.status,
          profile: profileMap.get(m.user_id) || null
        })).filter(m => m.profile);
      });
    },

    async getSharedGroupMembers(userId) {
      return withError(async () => {
        const client = getClient();
        const { data: myMemberships, error: myMemError } = await client
          .from('group_memberships')
          .select('group_id, groups(id, slug, name)')
          .eq('user_id', userId)
          .in('status', ['self_reported', 'verified']);
        if (myMemError) throw myMemError;
        if (!myMemberships || !myMemberships.length) return [];

        const groupIds = myMemberships.map(m => m.group_id).filter(Boolean);
        const groupMap = new Map(myMemberships.map(m => [m.group_id, m.groups]));

        const { data: peerMemberships, error: peerMemError } = await client
          .from('group_memberships')
          .select('user_id, group_id, status, groups(id, slug, name)')
          .in('group_id', groupIds)
          .neq('user_id', userId)
          .in('status', ['self_reported', 'verified']);
        if (peerMemError) throw peerMemError;
        if (!peerMemberships || !peerMemberships.length) return [];

        const peerUserIds = [...new Set(peerMemberships.map(m => m.user_id))];
        const { data: profiles, error: profError } = await client
          .from('public_profiles')
          .select('id, username, full_name, headline, location, school_or_organization, major, graduation_year, bio, photo_path')
          .in('id', peerUserIds);
        if (profError) throw profError;

        const profileMap = new Map((profiles || []).map(p => [p.id, p]));
        const peerMap = new Map();

        peerMemberships.forEach(m => {
          const profile = profileMap.get(m.user_id);
          if (!profile) return;
          const slug = m.groups?.slug || groupMap.get(m.group_id)?.slug;
          if (!peerMap.has(m.user_id)) {
            peerMap.set(m.user_id, {
              ...profile,
              groupSlugs: slug ? [slug] : [],
              memberships: [{ groupId: m.group_id, slug, status: m.status }]
            });
          } else {
            const existing = peerMap.get(m.user_id);
            if (slug && !existing.groupSlugs.includes(slug)) {
              existing.groupSlugs.push(slug);
            }
            existing.memberships.push({ groupId: m.group_id, slug, status: m.status });
          }
        });

        return [...peerMap.values()];
      });
    },

    async completeOnboarding({ profile, entries = [], groups = [] }) {
      return withError(async () => {
        const client = getClient();
        const profileUpdate = {
          ...profile,
          onboarding_completed_at: new Date().toISOString()
        };
        const { data: updatedProfile, error: profileError } = await client
          .from('profiles')
          .update(profileUpdate)
          .eq('id', profile.id)
          .select()
          .single();
        if (profileError) throw profileError;

        if (entries && entries.length) {
          const entryPayload = entries.map(entry => ({
            profile_id: profile.id,
            entry_type: entry.entry_type || 'skill',
            source: entry.source || 'manual',
            content: entry.content || {},
            approval_state: entry.approval_state || 'approved',
            visibility: entry.visibility || 'public'
          }));
          const { error: entryError } = await client.from('profile_entries').insert(entryPayload);
          if (entryError) console.warn('Could not persist profile entries during onboarding:', entryError);
        }

        if (groups && groups.length) {
          try {
            const { data: dbGroups } = await client
              .from('groups')
              .select('id, slug')
              .in('slug', groups);

            if (dbGroups && dbGroups.length) {
              const memberships = dbGroups.map(g => ({
                user_id: profile.id,
                group_id: g.id,
                status: 'self_reported'
              }));
              await client.from('group_memberships').upsert(memberships, { onConflict: 'user_id, group_id' });
            }
          } catch (groupErr) {
            console.warn('Could not persist group memberships during onboarding:', groupErr);
          }
        }

        return updatedProfile;
      });
    }
  };
})();
