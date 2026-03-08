function validatePassword(pwd) {
  const minLen = 6;
  const hasUpper = /[A-Z]/.test(pwd);
  const hasLower = /[a-z]/.test(pwd);
  const hasDigit = /\d/.test(pwd);
  const hasSpecial = /[^A-Za-z0-9]/.test(pwd);

  const ok = pwd.length >= minLen && hasUpper && hasLower && hasDigit && hasSpecial;
  return {
    ok,
    reasons: [
      pwd.length >= minLen ? null : "Min 6 caractères",
      hasUpper ? null : "Au moins 1 majuscule",
      hasLower ? null : "Au moins 1 minuscule",
      hasDigit ? null : "Au moins 1 chiffre",
      hasSpecial ? null : "Au moins 1 caractère spécial"
    ].filter(Boolean)
  };
}

module.exports = { validatePassword };