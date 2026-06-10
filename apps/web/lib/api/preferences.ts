import { call } from "./call";
import type { UserPreferencesDto, UpdateUserPreferencesInput } from "@andy-code-cat/contracts";

export interface UserPreferencesResponse {
    preferences: UserPreferencesDto;
}

export function getUserPreferences(token: string): Promise<UserPreferencesResponse> {
    return call<UserPreferencesResponse>("GET", "/v1/users/me/preferences", undefined, {
        Authorization: `Bearer ${token}`,
    });
}

export function updateUserPreferences(
    token: string,
    input: UpdateUserPreferencesInput,
): Promise<UserPreferencesResponse> {
    return call<UserPreferencesResponse>("PUT", "/v1/users/me/preferences", input, {
        Authorization: `Bearer ${token}`,
    });
}
