/** Open the app with ?demo=1 to load a realistic three-week history (for demos and judges). */
export function seedDemoIfRequested() {
  if (!new URLSearchParams(location.search).has("demo")) return;
  const day = (n: number) => {
    const x = new Date(Date.now() - n * 86_400_000);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  };
  const ko =
    navigator.language?.startsWith("ko") &&
    !location.search.includes("lang=en");
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("glpfit.")) localStorage.removeItem(key);
    }
    localStorage.setItem("glpfit.lang.v1", ko ? "ko" : "en");
    localStorage.setItem(
      "glpfit.profile.v1",
      JSON.stringify({
        nickname: ko ? "민지" : "Minji",
        goal: "muscle",
        heightCm: 163,
        startWeightKg: 82,
        targetWeightKg: 70,
        drug: "mounjaro",
        doseMg: 5,
        medication: "",
        injectionWeekday: new Date(Date.now() - 3 * 86_400_000).getDay(),
        concerns: ["nausea", "muscle_loss"],
        dietNotes: ko
          ? "아침을 자주 거르고 점심은 회사 근처 외식"
          : "Often skips breakfast, lunch out near the office",
        tone: "gentle",
      }),
    );
    localStorage.setItem(
      "glpfit.injections.v1",
      JSON.stringify([
        {
          id: "s3",
          date: day(3),
          drug: "mounjaro",
          doseMg: 5,
          site: "abdomen_right",
        },
        {
          id: "s2",
          date: day(10),
          drug: "mounjaro",
          doseMg: 5,
          site: "abdomen_left",
        },
        {
          id: "s1",
          date: day(17),
          drug: "mounjaro",
          doseMg: 2.5,
          site: "thigh_right",
        },
      ]),
    );
    const weights: [number, number, string[]?][] = [
      [20, 82.0],
      [17, 81.6, ["nausea"]],
      [14, 81.1],
      [12, 80.9],
      [10, 80.6, ["nausea"]],
      [8, 80.2],
      [6, 80.0, ["cravings"]],
      [3, 79.6, ["nausea"]],
      [2, 79.4, ["nausea"]],
      [1, 79.2],
    ];
    localStorage.setItem(
      "glpfit.logs.v1",
      JSON.stringify(
        weights
          .map(([n, kg, symptoms]) => ({
            date: day(n),
            weightKg: kg,
            waterCups: null,
            proteinServings: null,
            symptoms: symptoms ?? [],
            note: "",
          }))
          .reverse(),
      ),
    );
    localStorage.setItem(
      "glpfit.supply.v1",
      JSON.stringify({ date: day(10), pens: 4 }),
    );
    localStorage.setItem(
      "glpfit.memories.v1",
      JSON.stringify([
        ko
          ? "기름진 음식 먹으면 거의 항상 메스꺼움"
          : "Greasy food almost always makes me nauseous",
      ]),
    );
  } catch {
    return;
  }
  history.replaceState(null, "", location.pathname);
}
