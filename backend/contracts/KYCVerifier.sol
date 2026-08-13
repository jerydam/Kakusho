// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  KYCVerifier
 * @notice On-chain KYC verification registry + Soulbound Token (SBT).
 *
 * - Operator (backend wallet) marks addresses as verified after off-chain KYC.
 * - Verified users can mint a non-transferable SBT as portable proof.
 * - SBTs cannot be transferred — only burned by the holder or revoked by operator.
 * - dApps call isVerified(addr) or hasSBT(addr) to gate access.
 */
contract KYCVerifier {

    // ─── State ───────────────────────────────────────────────────────────────

    address public owner;
    address public operator;           // backend hot wallet that calls setVerified

    mapping(address => bool)    public verified;
    mapping(address => uint256) public sbtTokenId;   // 0 = no SBT minted
    mapping(uint256 => address) public tokenOwner;
    mapping(address => uint256) public verifiedAt;   // timestamp of verification

    uint256 private _nextTokenId = 1;
    uint256 public totalVerified;
    uint256 public totalSBTs;

    // ─── Events ──────────────────────────────────────────────────────────────

    event Verified(address indexed user, uint256 timestamp);
    event Revoked(address indexed user);
    event SBTMinted(address indexed user, uint256 indexed tokenId);
    event SBTBurned(address indexed user, uint256 indexed tokenId);
    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotOwner();
    error NotOperator();
    error NotVerified();
    error AlreadyVerified();
    error AlreadyHasSBT();
    error NoSBT();
    error SBTNotTransferable();
    error ZeroAddress();

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != owner) revert NotOperator();
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _operator) {
        if (_operator == address(0)) revert ZeroAddress();
        owner    = msg.sender;
        operator = _operator;
    }

    // ─── Operator: verification management ───────────────────────────────────

    /**
     * @notice Mark an address as KYC-verified. Called by backend after approval.
     */
    function setVerified(address user) external onlyOperator {
        if (user == address(0))    revert ZeroAddress();
        if (verified[user])        revert AlreadyVerified();

        verified[user]    = true;
        verifiedAt[user]  = block.timestamp;
        totalVerified++;

        emit Verified(user, block.timestamp);
    }

    /**
     * @notice Batch verify multiple addresses in one tx (gas-efficient for onboarding).
     */
    function batchSetVerified(address[] calldata users) external onlyOperator {
        for (uint256 i = 0; i < users.length; i++) {
            address u = users[i];
            if (u == address(0) || verified[u]) continue;
            verified[u]   = true;
            verifiedAt[u] = block.timestamp;
            totalVerified++;
            emit Verified(u, block.timestamp);
        }
    }

    /**
     * @notice Revoke verification (e.g. fraud detected). Burns SBT if minted.
     */
    function revokeVerification(address user) external onlyOperator {
        verified[user]   = false;
        verifiedAt[user] = 0;
        totalVerified    = totalVerified > 0 ? totalVerified - 1 : 0;

        // Burn SBT if exists
        uint256 tokenId = sbtTokenId[user];
        if (tokenId != 0) {
            _burnSBT(user, tokenId);
        }

        emit Revoked(user);
    }

    // ─── SBT: mint / burn ────────────────────────────────────────────────────

    /**
     * @notice Mint a Soulbound Token for a verified address.
     *         Can be called by the operator (on behalf of user) or by the user themselves.
     * @return tokenId  The newly minted token ID.
     */
    function mintSBT(address user) external onlyOperator returns (uint256 tokenId) {
        if (!verified[user])       revert NotVerified();
        if (sbtTokenId[user] != 0) revert AlreadyHasSBT();

        tokenId          = _nextTokenId++;
        sbtTokenId[user] = tokenId;
        tokenOwner[tokenId] = user;
        totalSBTs++;

        emit SBTMinted(user, tokenId);
    }

    /**
     * @notice Burn your own SBT (opt-out of on-chain identity).
     *         Does NOT revoke KYC verification — only removes the token.
     */
    function burnMySBT() external {
        uint256 tokenId = sbtTokenId[msg.sender];
        if (tokenId == 0) revert NoSBT();
        _burnSBT(msg.sender, tokenId);
    }

    function _burnSBT(address user, uint256 tokenId) internal {
        delete sbtTokenId[user];
        delete tokenOwner[tokenId];
        totalSBTs = totalSBTs > 0 ? totalSBTs - 1 : 0;
        emit SBTBurned(user, tokenId);
    }

    // ─── Read functions ───────────────────────────────────────────────────────

    /**
     * @notice Primary gate check — returns true if address is KYC verified.
     */
    function isVerified(address user) external view returns (bool) {
        return verified[user];
    }

    /**
     * @notice Returns true if the address holds an active SBT.
     */
    function hasSBT(address user) external view returns (bool) {
        return sbtTokenId[user] != 0;
    }

    /**
     * @notice Returns verification timestamp (0 if not verified).
     */
    function getVerifiedAt(address user) external view returns (uint256) {
        return verifiedAt[user];
    }

    /**
     * @notice Full status in one call — useful for dApp gating.
     */
    function getStatus(address user) external view returns (
        bool isVerif,
        bool hasSbt,
        uint256 tokenId,
        uint256 timestamp
    ) {
        return (
            verified[user],
            sbtTokenId[user] != 0,
            sbtTokenId[user],
            verifiedAt[user]
        );
    }

    // ─── ERC-5192 minimal (SBT standard) ─────────────────────────────────────

    /**
     * @dev ERC-5192: tokens are locked (non-transferable) by definition.
     */
    function locked(uint256 tokenId) external view returns (bool) {
        return tokenOwner[tokenId] != address(0);  // true while token exists
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert ZeroAddress();
        emit OperatorUpdated(operator, newOperator);
        operator = newOperator;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }
}