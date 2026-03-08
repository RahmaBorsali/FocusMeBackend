function makeInitials(username) {
  const parts = username.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const one = parts[0] || "U";
  return (one.slice(0, 2)).toUpperCase();
}

module.exports = { makeInitials };