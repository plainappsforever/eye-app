// Jest runs in a fixed zone so date logic near midnight and daylight-saving changes is deterministic
// (V2 P4: Home used the UTC date and showed the wrong day between 00:00 and 02:00 CEST).
module.exports = async () => {
  process.env.TZ = 'Europe/Berlin';
};
