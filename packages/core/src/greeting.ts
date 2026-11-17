/** The home greeting's catalog key for the local hour: morning before 12, afternoon before 17, then evening. */
export function greetingKey(
  date: Date = new Date(),
): 'home.greetingMorning' | 'home.greetingAfternoon' | 'home.greetingEvening' {
  const hour = date.getHours();
  if (hour < 12) return 'home.greetingMorning';
  if (hour < 17) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}
