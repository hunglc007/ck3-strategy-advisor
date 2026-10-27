import { expect, test } from "vitest";
import { parseProvinceRegions } from "../src/provinces.js";

const TITLES = `
e_britannia = {
	color = { 10 20 30 }
	k_ireland = {
		color = rgb { 1 2 3 }
		d_munster = {
			c_thomond = {
				color = hsv { 0.1 0.2 0.3 }
				b_limerick = { province = 2167 }
				b_ennis = { province = 2168 }
			}
		}
	}
}
k_norway = {
	d_vestfold = { c_oslo = { b_oslo = { province = 77 } } }
}
`;

test("maps each barony's province to its county, duchy, kingdom and empire", () => {
  const m = parseProvinceRegions(TITLES);
  expect(m.get(2167)).toEqual({
    county: "c_thomond",
    duchy: "d_munster",
    kingdom: "k_ireland",
    empire: "e_britannia",
  });
  expect(m.get(2168)!.kingdom).toBe("k_ireland");
  expect(m.get(77)).toEqual({
    county: "c_oslo",
    duchy: "d_vestfold",
    kingdom: "k_norway",
    empire: null,
  });
});
