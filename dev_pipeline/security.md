# Security Report

## TASK
probe

## Findings (200)
1. [medium] catch_without_rethrow - server/admin.mjs:19 - try/catch block without rethrow detected
2. [medium] catch_without_rethrow - server/admin.mjs:44 - try/catch block without rethrow detected
3. [medium] catch_without_rethrow - server/admin.mjs:61 - try/catch block without rethrow detected
4. [medium] catch_without_rethrow - server/admin.mjs:87 - try/catch block without rethrow detected
5. [medium] catch_without_rethrow - server/admin.mjs:118 - try/catch block without rethrow detected
6. [medium] catch_without_rethrow - server/admin.mjs:143 - try/catch block without rethrow detected
7. [medium] catch_without_rethrow - server/admin.mjs:184 - try/catch block without rethrow detected
8. [medium] catch_without_rethrow - server/admin.mjs:220 - try/catch block without rethrow detected
9. [medium] catch_without_rethrow - server/admin.mjs:268 - try/catch block without rethrow detected
10. [medium] catch_without_rethrow - server/admin.mjs:292 - try/catch block without rethrow detected
11. [medium] catch_without_rethrow - server/admin.mjs:333 - try/catch block without rethrow detected
12. [medium] catch_without_rethrow - server/admin.mjs:357 - try/catch block without rethrow detected
13. [medium] catch_without_rethrow - server/admin.mjs:391 - try/catch block without rethrow detected
14. [medium] catch_without_rethrow - server/admin.mjs:420 - try/catch block without rethrow detected
15. [medium] catch_without_rethrow - server/admin.mjs:476 - try/catch block without rethrow detected
16. [medium] catch_without_rethrow - server/admin.mjs:500 - try/catch block without rethrow detected
17. [medium] catch_without_rethrow - server/admin.mjs:524 - try/catch block without rethrow detected
18. [low] new_date_usage - server/admin.mjs:422 - new Date() usage detected
19. [low] default_fallback - server/admin.mjs:64 - Default fallback (||) detected
20. [low] default_fallback - server/admin.mjs:91 - Default fallback (||) detected
21. [low] default_fallback - server/admin.mjs:122 - Default fallback (||) detected
22. [low] default_fallback - server/admin.mjs:230 - Default fallback (||) detected
23. [low] default_fallback - server/admin.mjs:242 - Default fallback (||) detected
24. [low] default_fallback - server/admin.mjs:244 - Default fallback (||) detected
25. [low] default_fallback - server/admin.mjs:245 - Default fallback (||) detected
26. [low] default_fallback - server/admin.mjs:246 - Default fallback (||) detected
27. [low] default_fallback - server/admin.mjs:247 - Default fallback (||) detected
28. [low] default_fallback - server/admin.mjs:295 - Default fallback (||) detected
29. [low] default_fallback - server/admin.mjs:295 - Default fallback (||) detected
30. [low] default_fallback - server/admin.mjs:337 - Default fallback (||) detected
31. [low] default_fallback - server/admin.mjs:359 - Default fallback (||) detected
32. [low] default_fallback - server/admin.mjs:364 - Default fallback (||) detected
33. [low] default_fallback - server/admin.mjs:364 - Default fallback (||) detected
34. [low] default_fallback - server/admin.mjs:433 - Default fallback (||) detected
35. [low] default_fallback - server/admin.mjs:442 - Default fallback (||) detected
36. [low] default_fallback - server/admin.mjs:459 - Default fallback (||) detected
37. [low] default_fallback - server/admin.mjs:460 - Default fallback (||) detected
38. [medium] catch_without_rethrow - server/auth.js:17 - try/catch block without rethrow detected
39. [medium] catch_without_rethrow - server/auth.js:128 - try/catch block without rethrow detected
40. [medium] catch_without_rethrow - server/auth.js:142 - try/catch block without rethrow detected
41. [medium] catch_without_rethrow - server/auth.js:168 - try/catch block without rethrow detected
42. [low] default_fallback - server/auth.js:7 - Default fallback (||) detected
43. [low] default_fallback - server/auth.js:24 - Default fallback (||) detected
44. [low] default_fallback - server/auth.js:31 - Default fallback (||) detected
45. [low] default_fallback - server/auth.js:114 - Default fallback (||) detected
46. [low] default_fallback - server/auth.js:119 - Default fallback (||) detected
47. [low] default_fallback - server/auth.js:143 - Default fallback (||) detected
48. [low] default_fallback - server/auth.js:145 - Default fallback (||) detected
49. [high] missing_role_check - server/auth.js:141 - Potential mutating route without explicit role middleware
50. [high] sql_interpolation - server/auto-complete-trips.mjs:20 - Template SQL with interpolation detected
51. [high] sql_interpolation - server/auto-complete-trips.mjs:26 - Template SQL with interpolation detected
52. [high] sql_interpolation - server/auto-complete-trips.mjs:46 - Template SQL with interpolation detected
53. [high] sql_interpolation - server/auto-complete-trips.mjs:143 - Template SQL with interpolation detected
54. [high] sql_interpolation - server/auto-complete-trips.mjs:180 - Template SQL with interpolation detected
55. [low] new_date_usage - server/auto-complete-trips.mjs:94 - new Date() usage detected
56. [low] new_date_usage - server/auto-complete-trips.mjs:98 - new Date() usage detected
57. [low] new_date_usage - server/auto-complete-trips.mjs:191 - new Date() usage detected
58. [low] default_fallback - server/auto-complete-trips.mjs:91 - Default fallback (||) detected
59. [low] default_fallback - server/auto-complete-trips.mjs:91 - Default fallback (||) detected
60. [low] default_fallback - server/auto-complete-trips.mjs:91 - Default fallback (||) detected
61. [low] default_fallback - server/auto-complete-trips.mjs:91 - Default fallback (||) detected
62. [low] default_fallback - server/auto-complete-trips.mjs:182 - Default fallback (||) detected
63. [low] default_fallback - server/auto-complete-trips.mjs:224 - Default fallback (||) detected
64. [high] sql_interpolation - server/db.js:44 - Template SQL with interpolation detected
65. [high] sql_interpolation - server/db.js:210 - Template SQL with interpolation detected
66. [high] sql_interpolation - server/db.js:232 - Template SQL with interpolation detected
67. [high] sql_interpolation - server/db.js:251 - Template SQL with interpolation detected
68. [high] sql_interpolation - server/db.js:273 - Template SQL with interpolation detected
69. [high] sql_interpolation - server/db.js:305 - Template SQL with interpolation detected
70. [high] sql_interpolation - server/db.js:315 - Template SQL with interpolation detected
71. [high] sql_interpolation - server/db.js:463 - Template SQL with interpolation detected
72. [high] sql_interpolation - server/db.js:482 - Template SQL with interpolation detected
73. [high] sql_interpolation - server/db.js:502 - Template SQL with interpolation detected
74. [high] sql_interpolation - server/db.js:510 - Template SQL with interpolation detected
75. [high] sql_interpolation - server/db.js:554 - Template SQL with interpolation detected
76. [high] sql_interpolation - server/db.js:787 - Template SQL with interpolation detected
77. [high] sql_interpolation - server/db.js:1719 - Template SQL with interpolation detected
78. [medium] catch_without_rethrow - server/db.js:20 - try/catch block without rethrow detected
79. [medium] catch_without_rethrow - server/db.js:34 - try/catch block without rethrow detected
80. [medium] catch_without_rethrow - server/db.js:136 - try/catch block without rethrow detected
81. [medium] catch_without_rethrow - server/db.js:151 - try/catch block without rethrow detected
82. [medium] catch_without_rethrow - server/db.js:161 - try/catch block without rethrow detected
83. [medium] catch_without_rethrow - server/db.js:175 - try/catch block without rethrow detected
84. [medium] catch_without_rethrow - server/db.js:337 - try/catch block without rethrow detected
85. [medium] catch_without_rethrow - server/db.js:359 - try/catch block without rethrow detected
86. [medium] catch_without_rethrow - server/db.js:387 - try/catch block without rethrow detected
87. [medium] catch_without_rethrow - server/db.js:406 - try/catch block without rethrow detected
88. [medium] catch_without_rethrow - server/db.js:435 - try/catch block without rethrow detected
89. [medium] catch_without_rethrow - server/db.js:460 - try/catch block without rethrow detected
90. [medium] catch_without_rethrow - server/db.js:528 - try/catch block without rethrow detected
91. [medium] catch_without_rethrow - server/db.js:551 - try/catch block without rethrow detected
92. [medium] catch_without_rethrow - server/db.js:575 - try/catch block without rethrow detected
93. [medium] catch_without_rethrow - server/db.js:594 - try/catch block without rethrow detected
94. [medium] catch_without_rethrow - server/db.js:613 - try/catch block without rethrow detected
95. [medium] catch_without_rethrow - server/db.js:636 - try/catch block without rethrow detected
96. [medium] catch_without_rethrow - server/db.js:663 - try/catch block without rethrow detected
97. [medium] catch_without_rethrow - server/db.js:686 - try/catch block without rethrow detected
98. [medium] catch_without_rethrow - server/db.js:723 - try/catch block without rethrow detected
99. [medium] catch_without_rethrow - server/db.js:748 - try/catch block without rethrow detected
100. [medium] catch_without_rethrow - server/db.js:785 - try/catch block without rethrow detected
101. [medium] catch_without_rethrow - server/db.js:820 - try/catch block without rethrow detected
102. [medium] catch_without_rethrow - server/db.js:842 - try/catch block without rethrow detected
103. [medium] catch_without_rethrow - server/db.js:875 - try/catch block without rethrow detected
104. [medium] catch_without_rethrow - server/db.js:914 - try/catch block without rethrow detected
105. [medium] catch_without_rethrow - server/db.js:954 - try/catch block without rethrow detected
106. [medium] catch_without_rethrow - server/db.js:979 - try/catch block without rethrow detected
107. [medium] catch_without_rethrow - server/db.js:1016 - try/catch block without rethrow detected
108. [medium] catch_without_rethrow - server/db.js:1094 - try/catch block without rethrow detected
109. [medium] catch_without_rethrow - server/db.js:1117 - try/catch block without rethrow detected
110. [medium] catch_without_rethrow - server/db.js:1148 - try/catch block without rethrow detected
111. [medium] catch_without_rethrow - server/db.js:1190 - try/catch block without rethrow detected
112. [medium] catch_without_rethrow - server/db.js:1268 - try/catch block without rethrow detected
113. [medium] catch_without_rethrow - server/db.js:1326 - try/catch block without rethrow detected
114. [medium] catch_without_rethrow - server/db.js:1355 - try/catch block without rethrow detected
115. [medium] catch_without_rethrow - server/db.js:1423 - try/catch block without rethrow detected
116. [medium] catch_without_rethrow - server/db.js:1449 - try/catch block without rethrow detected
117. [medium] catch_without_rethrow - server/db.js:1480 - try/catch block without rethrow detected
118. [medium] catch_without_rethrow - server/db.js:1524 - try/catch block without rethrow detected
119. [medium] catch_without_rethrow - server/db.js:1567 - try/catch block without rethrow detected
120. [medium] catch_without_rethrow - server/db.js:1596 - try/catch block without rethrow detected
121. [medium] catch_without_rethrow - server/db.js:1700 - try/catch block without rethrow detected
122. [medium] catch_without_rethrow - server/db.js:1756 - try/catch block without rethrow detected
123. [medium] catch_without_rethrow - server/db.js:1784 - try/catch block without rethrow detected
124. [medium] catch_without_rethrow - server/db.js:1805 - try/catch block without rethrow detected
125. [medium] catch_without_rethrow - server/db.js:1836 - try/catch block without rethrow detected
126. [medium] catch_without_rethrow - server/db.js:1862 - try/catch block without rethrow detected
127. [medium] catch_without_rethrow - server/db.js:1912 - try/catch block without rethrow detected
128. [low] default_fallback - server/db.js:13 - Default fallback (||) detected
129. [low] default_fallback - server/db.js:15 - Default fallback (||) detected
130. [low] default_fallback - server/db.js:16 - Default fallback (||) detected
131. [low] default_fallback - server/db.js:425 - Default fallback (||) detected
132. [low] default_fallback - server/db.js:468 - Default fallback (||) detected
133. [low] default_fallback - server/db.js:474 - Default fallback (||) detected
134. [low] default_fallback - server/db.js:547 - Default fallback (||) detected
135. [low] default_fallback - server/db.js:571 - Default fallback (||) detected
136. [low] default_fallback - server/db.js:590 - Default fallback (||) detected
137. [low] default_fallback - server/db.js:609 - Default fallback (||) detected
138. [low] default_fallback - server/db.js:627 - Default fallback (||) detected
139. [low] default_fallback - server/db.js:1085 - Default fallback (||) detected
140. [low] default_fallback - server/db.js:1262 - Default fallback (||) detected
141. [low] default_fallback - server/db.js:1320 - Default fallback (||) detected
142. [low] default_fallback - server/db.js:1349 - Default fallback (||) detected
143. [low] default_fallback - server/db.js:1416 - Default fallback (||) detected
144. [low] default_fallback - server/db.js:1442 - Default fallback (||) detected
145. [low] default_fallback - server/db.js:1461 - Default fallback (||) detected
146. [low] default_fallback - server/db.js:1470 - Default fallback (||) detected
147. [low] default_fallback - server/db.js:1517 - Default fallback (||) detected
148. [low] default_fallback - server/db.js:1560 - Default fallback (||) detected
149. [low] default_fallback - server/db.js:1584 - Default fallback (||) detected
150. [low] default_fallback - server/db.js:1628 - Default fallback (||) detected
151. [low] default_fallback - server/db.js:1690 - Default fallback (||) detected
152. [low] default_fallback - server/db.js:1749 - Default fallback (||) detected
153. [low] default_fallback - server/db.js:1777 - Default fallback (||) detected
154. [low] default_fallback - server/db.js:1798 - Default fallback (||) detected
155. [low] default_fallback - server/db.js:1829 - Default fallback (||) detected
156. [low] default_fallback - server/db.js:1855 - Default fallback (||) detected
157. [low] default_fallback - server/db.js:1905 - Default fallback (||) detected
158. [low] default_fallback - server/db.js:1942 - Default fallback (||) detected
159. [medium] money_arithmetic_without_rounding - server/db.js:1627 - Money arithmetic detected without money-rounding util/Math.round
160. [high] sql_interpolation - server/dispatcher-shift-ledger.mjs:50 - Template SQL with interpolation detected
161. [high] sql_interpolation - server/dispatcher-shift-ledger.mjs:105 - Template SQL with interpolation detected
162. [high] sql_interpolation - server/dispatcher-shift-ledger.mjs:137 - Template SQL with interpolation detected
163. [high] sql_interpolation - server/dispatcher-shift-ledger.mjs:1042 - Template SQL with interpolation detected
164. [medium] catch_without_rethrow - server/dispatcher-shift-ledger.mjs:35 - try/catch block without rethrow detected
165. [medium] catch_without_rethrow - server/dispatcher-shift-ledger.mjs:136 - try/catch block without rethrow detected
166. [medium] catch_without_rethrow - server/dispatcher-shift-ledger.mjs:165 - try/catch block without rethrow detected
167. [medium] catch_without_rethrow - server/dispatcher-shift-ledger.mjs:642 - try/catch block without rethrow detected
168. [medium] catch_without_rethrow - server/dispatcher-shift-ledger.mjs:756 - try/catch block without rethrow detected
169. [medium] catch_without_rethrow - server/dispatcher-shift-ledger.mjs:1041 - try/catch block without rethrow detected
170. [low] new_date_usage - server/dispatcher-shift-ledger.mjs:26 - new Date() usage detected
171. [low] default_fallback - server/dispatcher-shift-ledger.mjs:18 - Default fallback (||) detected
172. [low] default_fallback - server/dispatcher-shift-ledger.mjs:18 - Default fallback (||) detected
173. [low] default_fallback - server/dispatcher-shift-ledger.mjs:51 - Default fallback (||) detected
174. [low] default_fallback - server/dispatcher-shift-ledger.mjs:65 - Default fallback (||) detected
175. [low] default_fallback - server/dispatcher-shift-ledger.mjs:91 - Default fallback (||) detected
176. [low] default_fallback - server/dispatcher-shift-ledger.mjs:111 - Default fallback (||) detected
177. [low] default_fallback - server/dispatcher-shift-ledger.mjs:113 - Default fallback (||) detected
178. [low] default_fallback - server/dispatcher-shift-ledger.mjs:127 - Default fallback (||) detected
179. [low] default_fallback - server/dispatcher-shift-ledger.mjs:127 - Default fallback (||) detected
180. [low] default_fallback - server/dispatcher-shift-ledger.mjs:127 - Default fallback (||) detected
181. [low] default_fallback - server/dispatcher-shift-ledger.mjs:127 - Default fallback (||) detected
182. [low] default_fallback - server/dispatcher-shift-ledger.mjs:179 - Default fallback (||) detected
183. [low] default_fallback - server/dispatcher-shift-ledger.mjs:180 - Default fallback (||) detected
184. [low] default_fallback - server/dispatcher-shift-ledger.mjs:181 - Default fallback (||) detected
185. [low] default_fallback - server/dispatcher-shift-ledger.mjs:185 - Default fallback (||) detected
186. [low] default_fallback - server/dispatcher-shift-ledger.mjs:186 - Default fallback (||) detected
187. [low] default_fallback - server/dispatcher-shift-ledger.mjs:195 - Default fallback (||) detected
188. [low] default_fallback - server/dispatcher-shift-ledger.mjs:195 - Default fallback (||) detected
189. [low] default_fallback - server/dispatcher-shift-ledger.mjs:196 - Default fallback (||) detected
190. [low] default_fallback - server/dispatcher-shift-ledger.mjs:196 - Default fallback (||) detected
191. [low] default_fallback - server/dispatcher-shift-ledger.mjs:203 - Default fallback (||) detected
192. [low] default_fallback - server/dispatcher-shift-ledger.mjs:204 - Default fallback (||) detected
193. [low] default_fallback - server/dispatcher-shift-ledger.mjs:218 - Default fallback (||) detected
194. [low] default_fallback - server/dispatcher-shift-ledger.mjs:219 - Default fallback (||) detected
195. [low] default_fallback - server/dispatcher-shift-ledger.mjs:219 - Default fallback (||) detected
196. [low] default_fallback - server/dispatcher-shift-ledger.mjs:220 - Default fallback (||) detected
197. [low] default_fallback - server/dispatcher-shift-ledger.mjs:220 - Default fallback (||) detected
198. [low] default_fallback - server/dispatcher-shift-ledger.mjs:224 - Default fallback (||) detected
199. [low] default_fallback - server/dispatcher-shift-ledger.mjs:243 - Default fallback (||) detected
200. [low] default_fallback - server/dispatcher-shift-ledger.mjs:253 - Default fallback (||) detected

## Overall Severity
- high

## Status
- fail
