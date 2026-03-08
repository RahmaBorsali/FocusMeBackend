module.exports = (err, req, res, next) => {
  if (err.name === "ZodError") {
    return res.status(400).json({ error: "VALIDATION_ERROR", details: err.issues });
  }
  console.error(err);
  res.status(500).json({ error: "INTERNAL_ERROR" });
};