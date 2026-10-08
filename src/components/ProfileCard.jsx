import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { avatarUrl, localTime } from '../lib/profiles';
import { Avatar, Modal } from './ui';

// A teammate's profile: photo, role, team, local time and "about me". Opened from the
// members list. Only people who share a project can read each other's profiles (RLS).
export default function ProfileCard({ userId, onClose }) {
  const [person, setPerson] = useState(undefined);

  useEffect(() => {
    let alive = true;
    supabase.from('profiles')
      .select('id, full_name, email, color, avatar_path, job_title, department, bio, location, timezone')
      .eq('id', userId).maybeSingle()
      .then(({ data }) => alive && setPerson(data ?? null));
    return () => {
      alive = false;
    };
  }, [userId]);

  const time = person?.timezone ? localTime(person.timezone) : null;
  const photo = avatarUrl(person?.avatar_path);

  return (
    <Modal title="Profile" onClose={onClose} width={460}>
      {person === undefined && <p className="muted">Loading…</p>}
      {person === null && <p className="muted">This profile isn't available.</p>}
      {person && (
        <div className="profile-card">
          <div className="profile-card-head">
            {photo
              ? <img className="profile-card-photo" src={photo} alt="" />
              : <Avatar profile={person} size={72} />}
            <div className="profile-card-name">
              <h3>{person.full_name}</h3>
              {(person.job_title || person.department) && (
                <p className="muted">{[person.job_title, person.department].filter(Boolean).join(' · ')}</p>
              )}
            </div>
          </div>
          <dl className="profile-facts">
            <dt>Email</dt><dd><a href={`mailto:${person.email}`}>{person.email}</a></dd>
            {person.location && <><dt>Location</dt><dd>{person.location}</dd></>}
            {time && <><dt>Local time</dt><dd>{time} <span className="muted small">({person.timezone.replace(/_/g, ' ')})</span></dd></>}
          </dl>
          {person.bio && (
            <div>
              <p className="settings-label">About</p>
              <p className="profile-bio">{person.bio}</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
