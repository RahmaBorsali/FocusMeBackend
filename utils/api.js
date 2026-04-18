class ApiError extends Error {
  constructor(statusCode, body) {
    super(body && body.message ? body.message : "Request failed");
    this.statusCode = statusCode;
    this.body = body;
  }
}

function pickUserDto(user) {
  return {
    id: user._id,
    username: user.username,
    email: user.email,
    avatarType: user.avatarType,
    avatarInitials: user.avatarInitials,
    avatarUrl: user.avatarUrl || "",
    displayName: user.displayName || user.username,
    studyGoal: user.studyGoal || "",
    createdAt: user.createdAt
  };
}

function validationError(errors) {
  return new ApiError(400, { message: "Validation failed", errors });
}

module.exports = {
  ApiError,
  pickUserDto,
  validationError
};
