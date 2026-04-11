import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.dependencies import get_current_user
from app.core.database import get_db
from app.models.user import User, Team, Role, UserRole, SubTeam
from app.schemas.settings import ProfileUpdateReq, TeamUpdateReq, RoleUpdateReq, InviteMemberReq, SubTeamCreateReq, SubTeamUpdateReq, AddSubTeamMemberReq

router = APIRouter()

def _get_or_create_role(db: Session, role_name: str) -> Role:
    role = db.query(Role).filter(Role.name == role_name).first()
    if not role:
        role = Role(name=role_name)
        db.add(role)
        db.flush()
    return role

def _require_owner(db: Session, user_id: int, team_id: int):
    """Requires the user to have the 'owner' role for the given team."""
    user_roles = db.query(UserRole).filter(
        UserRole.user_id == user_id,
        UserRole.team_id == team_id
    ).all()
    
    for ur in user_roles:
        if ur.role and ur.role.name.lower() == "owner":
            return True
            
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Owners can perform this action.")

# --- PROFILE API ---

@router.put("/profile")
async def update_profile(
    req: ProfileUpdateReq,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == current_user.id).first()
    
    if req.email and req.email != user.email:
        existing = db.query(User).filter(User.email == req.email).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email is already in use by another account.")
        user.email = req.email
        
    if req.full_name is not None:
        user.full_name = req.full_name
    if req.notify_email is not None:
        user.notify_email = req.notify_email
    if req.notify_dashboard is not None:
        user.notify_dashboard = req.notify_dashboard
    if req.notify_deadline is not None:
        user.notify_deadline = req.notify_deadline

    db.commit()
    db.refresh(user)
    
    return {
        "message": "Profile updated successfully.", 
        "full_name": user.full_name, 
        "email": user.email,
        "notify_email": user.notify_email,
        "notify_dashboard": user.notify_dashboard,
        "notify_deadline": user.notify_deadline
    }

# --- TEAM / MEMBERS API ---

@router.get("/teams/{team_id}/members")
async def get_team_members(
    team_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team or current_user not in team.users:
        raise HTTPException(status_code=404, detail="Team not found or you are not a member.")
        
    members = []
    for member in team.users:
        # Determine this member's role for this team
        role_name = "viewer"
        user_roles = db.query(UserRole).filter(
            UserRole.user_id == member.id,
            UserRole.team_id == team_id
        ).all()
        for ur in user_roles:
            if ur.role and ur.role.name.lower() in ("owner", "editor", "viewer"):
                role_name = ur.role.name.lower()
                break
                
        members.append({
            "id": member.id,
            "full_name": member.full_name or member.email.split('@')[0],
            "email": member.email,
            "role": role_name,
            "avatar": member.avatar or "U",
        })
        
    return {"members": members}

@router.post("/teams/{team_id}/invites")
async def send_team_invite(
    team_id: int,
    req: InviteMemberReq,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team or current_user not in team.users:
        raise HTTPException(status_code=404, detail="Team not found.")
        
    _require_owner(db, current_user.id, team_id)

    # Check if user already exists in DB
    invitee = db.query(User).filter(User.email == req.email).first()
    if invitee:
        if invitee in team.users:
             raise HTTPException(status_code=400, detail="User is already in this team.")
        # Auto-add them to team since they exist in system
        team.users.append(invitee)
        r = _get_or_create_role(db, req.role.lower())
        db.add(UserRole(user_id=invitee.id, role_id=r.id, team_id=team.id))
        db.commit()
        return {"message": f"Successfully added existing user {req.email} to the team as {req.role}."}
    else:
        # User not in system yet. Simulate invite.
        print(f"[SIMULATED EMAIL] To: {req.email} - You have been invited to join Team '{team.team_name}' by {current_user.email} as a {req.role}.")
        return {"message": f"Invitation sent to {req.email}!"}

@router.delete("/teams/{team_id}/members/{user_id}")
async def remove_team_member(
    team_id: int,
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team or current_user not in team.users:
        raise HTTPException(status_code=404, detail="Team not found.")
        
    _require_owner(db, current_user.id, team_id)
    
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="You cannot remove yourself using this endpoint.")
        
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user or target_user not in team.users:
        raise HTTPException(status_code=404, detail="User is not in this team.")
        
    team.users.remove(target_user)
    
    # Remove their roles for this team
    db.query(UserRole).filter(
        UserRole.user_id == user_id, 
        UserRole.team_id == team_id
    ).delete()
    
    db.commit()
    return {"message": "Member removed successfully."}

@router.put("/teams/{team_id}/roles/{user_id}")
async def assign_role(
    team_id: int,
    user_id: int,
    req: RoleUpdateReq,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team or current_user not in team.users:
        raise HTTPException(status_code=404, detail="Team not found.")
        
    _require_owner(db, current_user.id, team_id)
    
    if req.role_name.lower() not in ["owner", "admin", "editor", "viewer"]:
        raise HTTPException(status_code=400, detail="Invalid role type.")
        
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user or target_user not in team.users:
        raise HTTPException(status_code=404, detail="User is not in this team.")

    # Prevent owner from demoting themselves if they are the only owner
    if current_user.id == user_id and req.role_name.lower() != "owner":
        # Check if there are other owners
        owner_r = _get_or_create_role(db, "owner")
        owner_count = db.query(UserRole).filter(UserRole.team_id == team_id, UserRole.role_id == owner_r.id).count()
        if owner_count <= 1:
            raise HTTPException(status_code=400, detail="You cannot demote yourself as you are the only owner.")

    # Replace existing role for this team
    db.query(UserRole).filter(
        UserRole.user_id == user_id, 
        UserRole.team_id == team_id
    ).delete()
    
    new_r = _get_or_create_role(db, req.role_name.lower())
    db.add(UserRole(user_id=user_id, role_id=new_r.id, team_id=team.id))
    db.commit()
    
    return {"message": f"Role '{req.role_name}' assigned to user."}

# --- SUBTEAM (UI: "TEAM") CRUD ---

def _require_owner_or_admin(db: Session, user_id: int, team_id: int):
    """Requires owner or admin role for the given team."""
    user_roles = db.query(UserRole).filter(
        UserRole.user_id == user_id,
        UserRole.team_id == team_id
    ).all()
    for ur in user_roles:
        if ur.role and ur.role.name.lower() in ("owner", "admin"):
            return True
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Owners or Admins can perform this action.")

@router.get("/teams/{team_id}/subteams")
async def list_subteams(
    team_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team or current_user not in team.users:
        raise HTTPException(status_code=404, detail="Project not found or you are not a member.")

    subteams = db.query(SubTeam).filter(SubTeam.team_id == team_id).all()
    result = []
    for st in subteams:
        result.append({
            "id": st.id,
            "name": st.name,
            "description": st.description,
            "color": st.color or "#4f46e5",
            "member_count": len(st.users),
        })
    return {"subteams": result}

@router.post("/teams/{team_id}/subteams", status_code=201)
async def create_subteam(
    team_id: int,
    req: SubTeamCreateReq,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team or current_user not in team.users:
        raise HTTPException(status_code=404, detail="Project not found.")

    _require_owner_or_admin(db, current_user.id, team_id)

    subteam = SubTeam(
        name=req.name,
        description=req.description,
        color=req.color or "#4f46e5",
        team_id=team_id,
    )
    db.add(subteam)
    db.commit()
    db.refresh(subteam)
    return {
        "id": subteam.id,
        "name": subteam.name,
        "description": subteam.description,
        "color": subteam.color,
        "member_count": 0,
    }

@router.put("/teams/{team_id}/subteams/{subteam_id}")
async def update_subteam(
    team_id: int,
    subteam_id: int,
    req: SubTeamUpdateReq,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team or current_user not in team.users:
        raise HTTPException(status_code=404, detail="Project not found.")

    _require_owner_or_admin(db, current_user.id, team_id)

    subteam = db.query(SubTeam).filter(SubTeam.id == subteam_id, SubTeam.team_id == team_id).first()
    if not subteam:
        raise HTTPException(status_code=404, detail="Team not found.")

    if req.name is not None:
        subteam.name = req.name
    if req.description is not None:
        subteam.description = req.description
    if req.color is not None:
        subteam.color = req.color

    db.commit()
    db.refresh(subteam)
    return {
        "id": subteam.id,
        "name": subteam.name,
        "description": subteam.description,
        "color": subteam.color,
        "member_count": len(subteam.users),
    }

@router.delete("/teams/{team_id}/subteams/{subteam_id}")
async def delete_subteam(
    team_id: int,
    subteam_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team or current_user not in team.users:
        raise HTTPException(status_code=404, detail="Project not found.")

    _require_owner(db, current_user.id, team_id)

    subteam = db.query(SubTeam).filter(SubTeam.id == subteam_id, SubTeam.team_id == team_id).first()
    if not subteam:
        raise HTTPException(status_code=404, detail="Team not found.")

    # Remove all member associations first
    subteam.users.clear()
    db.flush()
    db.delete(subteam)
    db.commit()
    return {"message": "Team deleted successfully."}


# --- SUBTEAM MEMBERS ---

@router.get("/teams/{team_id}/subteams/{subteam_id}/members")
async def list_subteam_members(
    team_id: int,
    subteam_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team or current_user not in team.users:
        raise HTTPException(status_code=404, detail="Project not found.")

    subteam = db.query(SubTeam).filter(SubTeam.id == subteam_id, SubTeam.team_id == team_id).first()
    if not subteam:
        raise HTTPException(status_code=404, detail="Team not found.")

    members = []
    for member in subteam.users:
        role_name = "viewer"
        user_roles = db.query(UserRole).filter(
            UserRole.user_id == member.id,
            UserRole.team_id == team_id
        ).all()
        for ur in user_roles:
            if ur.role:
                role_name = ur.role.name.lower()
                break
        initials = "".join(w[0] for w in (member.full_name or member.email.split("@")[0]).split())[:2].upper()
        members.append({
            "id": member.id,
            "full_name": member.full_name or member.email.split("@")[0],
            "email": member.email,
            "role": role_name,
            "initials": initials or "U",
        })

    # Also return all project members not yet in this subteam, for the add-member dropdown
    subteam_ids = {m.id for m in subteam.users}
    available = []
    for member in team.users:
        if member.id not in subteam_ids:
            available.append({
                "id": member.id,
                "full_name": member.full_name or member.email.split("@")[0],
                "email": member.email,
            })

    return {"members": members, "available": available}


@router.post("/teams/{team_id}/subteams/{subteam_id}/members", status_code=201)
async def add_subteam_member(
    team_id: int,
    subteam_id: int,
    req: AddSubTeamMemberReq,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team or current_user not in team.users:
        raise HTTPException(status_code=404, detail="Project not found.")

    _require_owner_or_admin(db, current_user.id, team_id)

    subteam = db.query(SubTeam).filter(SubTeam.id == subteam_id, SubTeam.team_id == team_id).first()
    if not subteam:
        raise HTTPException(status_code=404, detail="Team not found.")

    target = db.query(User).filter(User.id == req.user_id).first()
    if not target or target not in team.users:
        raise HTTPException(status_code=404, detail="User is not a project member.")

    if target in subteam.users:
        raise HTTPException(status_code=400, detail="User is already in this team.")

    subteam.users.append(target)
    db.commit()
    return {"message": "Member added to team."}


@router.delete("/teams/{team_id}/subteams/{subteam_id}/members/{user_id}")
async def remove_subteam_member(
    team_id: int,
    subteam_id: int,
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team or current_user not in team.users:
        raise HTTPException(status_code=404, detail="Project not found.")

    _require_owner_or_admin(db, current_user.id, team_id)

    subteam = db.query(SubTeam).filter(SubTeam.id == subteam_id, SubTeam.team_id == team_id).first()
    if not subteam:
        raise HTTPException(status_code=404, detail="Team not found.")

    target = db.query(User).filter(User.id == user_id).first()
    if not target or target not in subteam.users:
        raise HTTPException(status_code=404, detail="User is not in this team.")

    subteam.users.remove(target)
    db.commit()
    return {"message": "Member removed from team."}


# --- PROJECT SETTINGS INFO ---

@router.put("/teams/{team_id}")
async def update_project_info(
    team_id: int,
    req: TeamUpdateReq,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team or current_user not in team.users:
        raise HTTPException(status_code=404, detail="Team/Project not found.")
        
    _require_owner(db, current_user.id, team_id)
    
    if req.team_name is not None:
        team.team_name = req.team_name
    if req.description is not None:
        team.description = req.description
    if req.ai_sensitivity is not None:
        team.ai_sensitivity = req.ai_sensitivity
        
    db.commit()
    db.refresh(team)
    
    return {
        "message": "Project info updated successfully.",
        "team_name": team.team_name,
        "description": team.description,
        "ai_sensitivity": team.ai_sensitivity
    }


# --- INVITE CODE ---

@router.get("/teams/{team_id}/invite-info")
async def get_invite_info(
    team_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Return the team's invite code and member list for the General settings panel."""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team or current_user not in team.users:
        raise HTTPException(status_code=404, detail="Team not found or you are not a member.")

    members = []
    for member in team.users:
        role_name = "viewer"
        user_roles = db.query(UserRole).filter(
            UserRole.user_id == member.id,
            UserRole.team_id == team_id
        ).all()
        for ur in user_roles:
            if ur.role:
                role_name = ur.role.name.lower()
                break
        initials = "".join(w[0] for w in (member.full_name or member.email.split("@")[0]).split())[:2].upper()
        members.append({
            "id": member.id,
            "full_name": member.full_name or member.email.split("@")[0],
            "email": member.email,
            "role": role_name,
            "initials": initials or "U",
            "is_self": member.id == current_user.id,
        })

    # Determine current user role
    my_role = "viewer"
    for ur in db.query(UserRole).filter(UserRole.user_id == current_user.id, UserRole.team_id == team_id).all():
        if ur.role:
            my_role = ur.role.name.lower()
            break

    return {
        "invite_code": team.invite_code,
        "members": members,
        "my_role": my_role,
    }


@router.post("/teams/{team_id}/regenerate-invite")
async def regenerate_invite_code(
    team_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Generate a new invite code for the team (owner only)."""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team or current_user not in team.users:
        raise HTTPException(status_code=404, detail="Team not found.")

    _require_owner(db, current_user.id, team_id)

    new_code = str(uuid.uuid4())[:8]
    team.invite_code = new_code
    db.commit()
    return {"invite_code": new_code, "message": "Invite code regenerated."}


@router.post("/teams/{team_id}/subteams/{subteam_id}/invite")
async def invite_to_subteam(
    team_id: int,
    subteam_id: int,
    req: InviteMemberReq,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Invite a user (by email) to the project AND a specific subteam."""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team or current_user not in team.users:
        raise HTTPException(status_code=404, detail="Team not found.")

    _require_owner_or_admin(db, current_user.id, team_id)

    subteam = db.query(SubTeam).filter(SubTeam.id == subteam_id, SubTeam.team_id == team_id).first()
    if not subteam:
        raise HTTPException(status_code=404, detail="Subteam not found.")

    invitee = db.query(User).filter(User.email == req.email).first()
    if invitee:
        # Add to project if not already a member
        if invitee not in team.users:
            team.users.append(invitee)
            r = _get_or_create_role(db, req.role.lower())
            db.add(UserRole(user_id=invitee.id, role_id=r.id, team_id=team.id))

        # Add to subteam if not already a member
        if invitee not in subteam.users:
            subteam.users.append(invitee)

        db.commit()
        return {"message": f"Added {req.email} to team '{subteam.name}' as {req.role}."}
    else:
        print(f"[SIMULATED EMAIL] To: {req.email} - You have been invited to join Team '{subteam.name}' in project '{team.team_name}' by {current_user.email}.")
        return {"message": f"Invitation sent to {req.email} for team '{subteam.name}'."}
