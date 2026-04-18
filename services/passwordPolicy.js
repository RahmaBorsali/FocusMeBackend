function validatePassword(pwd) {
  const minLen = 8;
  const hasUpper = /[A-Z]/.test(pwd);
  const hasLower = /[a-z]/.test(pwd);
  const hasDigit = /\d/.test(pwd);
  const hasSpecial = /[^A-Za-z0-9]/.test(pwd);

  const ok = pwd.length >= minLen && hasUpper && hasLower && hasDigit && hasSpecial;
  return {
    ok,
    reasons: [
      pwd.length >= minLen ? null : "Minimum 8 characters",
      hasUpper ? null : "Au moins 1 majuscule",
      hasLower ? null : "Au moins 1 minuscule",
      hasDigit ? null : "Au moins 1 chiffre",
      hasSpecial ? null : "Au moins 1 caractere special"
    ].filter(Boolean)
  };
}

module.exports = { validatePassword };
