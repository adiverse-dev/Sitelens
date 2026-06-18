function isValidHttpUrl(value) {
  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch (error) {
    return false;
  }
}

function isValidOptionalUrl(value) {
  return value ? isValidHttpUrl(value) : false;
}

module.exports = {
  isValidHttpUrl,
  isValidOptionalUrl,
};
