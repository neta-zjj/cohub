import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildSpaceLandingRoute,
	buildUserNewSessionRoute,
} from "../lib/space-routes.ts";

test("space landing opens a new session in that workspace", () => {
	assert.equal(
		buildSpaceLandingRoute("space-home"),
		"/spaces/space-home/sessions/new",
	);
});

test("user session routes preserve the selected space", () => {
	assert.equal(
		buildUserNewSessionRoute("space-1"),
		"/sessions/new?space=space-1",
	);
	assert.equal(buildUserNewSessionRoute("a b"), "/sessions/new?space=a+b");
});
