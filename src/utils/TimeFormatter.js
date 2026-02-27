/**
 * Formats seconds into a human-readable time string
 * @param {number} seconds - Number of seconds
 * @returns {string} Formatted time string (e.g., "02:04" for 2 minutes 4 seconds, or "45 seconds")
 */
function formatWaitTime(seconds) {
  if (seconds < 60) {
    return `${seconds} seconds`;
  }
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

module.exports = { formatWaitTime };
